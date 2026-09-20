import { logger, toAppError } from "@lfsci/kernel";
import type { PgBoss } from "pg-boss";
import type { z } from "zod";
import { type JobBase, withJobCorrelation } from "../correlation";
import type { Deps } from "../deps";

const log = logger("worker.registry");

export const DEAD_LETTER_QUEUE = "dead.letter";

export type JobOutcome = { outcome: string } & Record<string, unknown>;

export type JobOptions = {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax?: number;
  expireInSeconds: number;
  /** Per-node worker count; 1 keeps a queue strictly serial. */
  localConcurrency?: number;
  batchSize?: number;
  deadLetter?: string;
};

export type JobSchedule = { cron: string; tz: string; data?: Record<string, unknown> };

export type JobDefinition<S extends z.ZodType<JobBase>> = {
  name: string;
  schema: S;
  options: JobOptions;
  schedule?: JobSchedule;
  handler: (data: z.infer<S>, deps: Deps) => Promise<JobOutcome>;
};

// biome-ignore lint/suspicious/noExplicitAny: the registry is heterogeneous by design; each entry stays typed at its definition site.
export type AnyJob = JobDefinition<z.ZodType<any>>;

export function defineJob<S extends z.ZodType<JobBase>>(
  definition: JobDefinition<S>,
): JobDefinition<S> {
  return definition;
}

export type DeadLetterPayload = {
  queue: string;
  reason: "invalid_data";
  issues: string[];
  data: unknown;
};

/**
 * Data that fails its schema can never succeed: it goes to the dead-letter
 * queue and the job completes, instead of burning its retries (OPS-01 —
 * an isolated rejection must not read as a resource outage).
 */
export async function runJob(
  job: AnyJob,
  raw: unknown,
  deps: Deps,
  send: (queue: string, data: object) => Promise<unknown>,
): Promise<JobOutcome> {
  const parsed = job.schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    log.error({ queue: job.name, issues }, "job data rejected, dead-lettered");
    const payload: DeadLetterPayload = {
      queue: job.name,
      reason: "invalid_data",
      issues,
      data: raw,
    };
    await send(DEAD_LETTER_QUEUE, payload);
    return { outcome: "dead_letter", issues };
  }

  const data = parsed.data as JobBase;
  return withJobCorrelation(data, async () => {
    try {
      return await job.handler(parsed.data, deps);
    } catch (error) {
      const appError = toAppError(error);
      log.error({ queue: job.name, code: appError.code, err: appError }, "job failed");
      throw appError;
    }
  });
}

export async function registerAll(
  boss: PgBoss,
  deps: Deps,
  jobs: readonly AnyJob[],
): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE, { retryLimit: 0, retentionSeconds: 30 * 24 * 3600 });

  for (const job of jobs) {
    await boss.createQueue(job.name, {
      retryLimit: job.options.retryLimit,
      retryDelay: job.options.retryDelay,
      retryBackoff: job.options.retryBackoff,
      ...(job.options.retryDelayMax === undefined
        ? {}
        : { retryDelayMax: job.options.retryDelayMax }),
      expireInSeconds: job.options.expireInSeconds,
      deadLetter: job.options.deadLetter ?? DEAD_LETTER_QUEUE,
    });
  }

  const send = (queue: string, data: object) => boss.send(queue, data);

  for (const job of jobs) {
    await boss.work(
      job.name,
      {
        batchSize: job.options.batchSize ?? 1,
        localConcurrency: job.options.localConcurrency ?? 1,
      },
      async (received) => {
        const outcomes: JobOutcome[] = [];
        for (const one of received) outcomes.push(await runJob(job, one.data, deps, send));
        return outcomes.length === 1 ? outcomes[0] : outcomes;
      },
    );
  }

  for (const job of jobs) {
    if (!job.schedule) continue;
    await boss.schedule(job.name, job.schedule.cron, job.schedule.data ?? {}, {
      tz: job.schedule.tz,
      missed: "once",
    });
  }
}
