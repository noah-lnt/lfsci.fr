import "server-only";
import { currentRequestId, logger } from "@lfsci/kernel";
import { PgBoss } from "pg-boss";
import { env } from "./env";

const log = logger("web.queue");

let boss: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

// The worker owns the pgboss schema and its migrations; the web app is a sender only.
async function sender(): Promise<PgBoss> {
  if (boss) return boss;
  if (!starting) {
    starting = (async () => {
      const instance = new PgBoss({
        connectionString: env().DATABASE_URL,
        schema: "pgboss",
        migrate: false,
        supervise: false,
        schedule: false,
      });
      instance.on("error", (error: Error) => log.error({ err: error }, "queue error"));
      await instance.start();
      boss = instance;
      return instance;
    })();
  }
  return starting;
}

export type JobData = Record<string, unknown> & { organizationId?: string };

/** Enqueues a worker job carrying the current request id; returns the job id or null when the queue is not installed yet. */
export async function enqueueJob(name: string, data: JobData): Promise<string | null> {
  const payload = { requestId: currentRequestId(), ...data };
  try {
    const instance = await sender();
    return await instance.send(name, payload);
  } catch (error) {
    log.warn({ err: error, job: name }, "job not enqueued");
    return null;
  }
}
