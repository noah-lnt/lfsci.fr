import { logger } from "@lfsci/kernel";
import * as Sentry from "@sentry/node";
import { PgBoss } from "pg-boss";
import { buildDeps, createHandles } from "./deps";
import { configuredVendors, loadEnv } from "./env";
import { createDbExchangeRecorder } from "./exchange-recorder";
import { startHealthServer } from "./health";
import { jobNames, jobs } from "./jobs";
import { registerAll } from "./jobs/registry";
import { heartbeat, reapOrphanedLeases } from "./ops";

const log = logger("worker.main");

export const HEARTBEAT_INTERVAL_MS = 30_000;

export async function start(): Promise<void> {
  const env = loadEnv();

  if (env.SENTRY_DSN) {
    Sentry.init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0, sendDefaultPii: false });
    log.info("sentry enabled");
  }

  const { db, admin } = createHandles(env);
  // pg-boss owns its schema and creates it: it connects with the admin URL,
  // because the application role holds DML only (tech pack §10).
  const boss = new PgBoss({ connectionString: env.DATABASE_ADMIN_URL, schema: env.PGBOSS_SCHEMA });
  boss.on("error", (error) => log.error({ err: error }, "pg-boss error"));

  const deps = buildDeps({
    env,
    db,
    admin,
    boss,
    recorder: createDbExchangeRecorder(db),
  });

  const vendors = configuredVendors(env);
  log.info({ workerId: env.WORKER_ID, vendors }, "worker starting");

  await boss.start();
  const reaped = await reapOrphanedLeases(admin);
  await registerAll(boss, deps, jobs);
  heartbeat(env.WORKER_ID, jobs.length);
  const health = startHealthServer(env.WORKER_HEALTH_PORT, jobNames);
  const beat = setInterval(
    () => heartbeat(env.WORKER_ID, jobs.length),
    HEARTBEAT_INTERVAL_MS,
  ).unref();

  log.info({ queues: jobNames, reapedLeases: reaped }, "worker ready");

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "worker stopping");
    clearInterval(beat);
    health.close();
    try {
      await boss.stop({ graceful: true });
    } catch (error) {
      log.error({ err: error }, "pg-boss stop failed");
    }
    await Promise.allSettled([db.close(), admin.close()]);
    log.info("worker stopped");
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (process.argv[1]?.endsWith("main.js") || process.argv[1]?.endsWith("main.ts")) {
  await start().catch((error: unknown) => {
    log.error({ err: error }, "worker failed to start");
    process.exitCode = 1;
  });
}
