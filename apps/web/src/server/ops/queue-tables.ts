import "server-only";
import { logger } from "@lfsci/kernel";
import type { OpsJob } from "@/lib/contracts/ops";
import { appDb } from "../data";

const log = logger("ops.queue");

export type JobStateCount = { name: string; state: string; count: number };

type Probe<T> = { available: boolean; rows: T[] };

/**
 * The worker owns the `pgboss` schema; before its first migration the tables do
 * not exist. "I could not look" must not render as "nothing found" (global rule).
 */
async function probe<T>(run: () => Promise<T[]>): Promise<Probe<T>> {
  try {
    return { available: true, rows: await run() };
  } catch (error) {
    log.warn({ err: error }, "pgboss tables unavailable");
    return { available: false, rows: [] };
  }
}

export async function jobsByRequestId(requestId: string): Promise<Probe<OpsJob>> {
  const sql = appDb().sql;
  return probe(async () => {
    const rows = await sql<
      {
        id: string;
        name: string;
        state: string;
        created_on: string | null;
        completed_on: string | null;
        output: unknown;
      }[]
    >`SELECT id::text, name, state::text,
             to_char(created_on, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS created_on,
             to_char(completed_on, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS completed_on,
             output
        FROM pgboss.job
       WHERE data->>'requestId' = ${requestId}
       ORDER BY created_on
       LIMIT 200`;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      createdOn: row.created_on,
      completedOn: row.completed_on,
      output: row.output === null ? null : JSON.stringify(row.output).slice(0, 500),
    }));
  });
}

export async function jobCounts(): Promise<Probe<JobStateCount>> {
  const sql = appDb().sql;
  return probe(async () => {
    const rows = await sql<{ name: string; state: string; count: string }[]>`
      SELECT name, state::text, count(*)::text AS count
        FROM pgboss.job GROUP BY name, state ORDER BY name, state`;
    return rows.map((row) => ({ name: row.name, state: row.state, count: Number(row.count) }));
  });
}
