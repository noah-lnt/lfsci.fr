import { newId } from "@lfsci/kernel";
import type { Deps, OdooPort } from "../src/deps";
import type { WorkerEnv } from "../src/env";

export type SentJob = { queue: string; data: unknown; afterSeconds?: number };

export function fakeBoss(): Pick<Deps, "boss">["boss"] & { sent: SentJob[] } {
  const sent: SentJob[] = [];
  return {
    sent,
    // biome-ignore lint/suspicious/noExplicitAny: mirrors pg-boss's overloaded signature.
    send: (async (queue: any, data: any) => {
      sent.push({ queue: String(queue), data });
      return newId();
      // biome-ignore lint/suspicious/noExplicitAny: same overload set.
    }) as any,
    // biome-ignore lint/suspicious/noExplicitAny: mirrors pg-boss's overloaded signature.
    sendAfter: (async (queue: any, data: any, _options: any, after: any) => {
      sent.push({ queue: String(queue), data, afterSeconds: Number(after) });
      return newId();
      // biome-ignore lint/suspicious/noExplicitAny: same overload set.
    }) as any,
  };
}

export const fakeEnv: WorkerEnv = {
  DATABASE_URL: "postgres://unused",
  DATABASE_ADMIN_URL: "postgres://unused",
  LOG_LEVEL: "error",
  WORKER_ID: "test-worker",
  WORKER_HEALTH_PORT: 9099,
  PGBOSS_SCHEMA: "pgboss_test",
  ODOO_RATE_LIMIT_PER_SECOND: 1,
  OLLAMA_MODEL_EMBED: "bge-m3",
  AI_EMBED_DIMENSIONS: 1024,
};

/** Every port absent by default; a test opts in to the one it exercises. */
export function fakeDeps(overrides: Partial<Deps> = {}): Deps {
  const boss = fakeBoss();
  return {
    env: fakeEnv,
    workerId: "test-worker",
    db: null as unknown as Deps["db"],
    admin: null as unknown as Deps["admin"],
    boss,
    now: () => new Date("2026-09-20T08:00:00.000Z"),
    odoo: null,
    storage: null,
    ocr: null,
    speech: null,
    ai: null,
    mail: null,
    insee: null,
    ...overrides,
  };
}

export function fakeOdooPort(operations: Partial<OdooPort["operations"]>): OdooPort {
  return {
    client: {} as OdooPort["client"],
    operations: operations as OdooPort["operations"],
    database: "lfsci-test",
    timeoutMs: 30_000,
  };
}
