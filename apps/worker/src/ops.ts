import type { DbHandle } from "@lfsci/db";
import { withoutTenant } from "@lfsci/db";
import { logger } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

const log = logger("worker.ops");

export type QueueSnapshot = {
  name: string;
  deferred: number;
  queued: number;
  ready: number;
  active: number;
  failed: number;
  total: number;
};

/** Feeds the `/admin/ops` screen of OPS-01: counts by state, per queue. */
export async function queueStats(boss: Pick<PgBoss, "getQueues">): Promise<QueueSnapshot[]> {
  const queues = await boss.getQueues();
  return queues
    .map((queue) => ({
      name: queue.name,
      deferred: queue.deferredCount,
      queued: queue.queuedCount,
      ready: queue.readyCount,
      active: queue.activeCount,
      failed: queue.failedCount,
      total: queue.totalCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type Heartbeat = { workerId: string; at: string; queues: number };

let lastHeartbeat: Heartbeat | null = null;

export function heartbeat(workerId: string, queues: number, at: Date = new Date()): Heartbeat {
  lastHeartbeat = { workerId, at: at.toISOString(), queues };
  return lastHeartbeat;
}

export function readHeartbeat(): Heartbeat | null {
  return lastHeartbeat;
}

/**
 * A crash leaves rows `leased` with an owner that no longer exists. Their lease
 * eventually expires and `claimOutbox` reclaims them, but a boot-time sweep
 * returns them immediately instead of waiting out the TTL.
 */
export async function reapOrphanedLeases(admin: DbHandle): Promise<number> {
  const reaped = await withoutTenant(admin, async (tx) => {
    const rows = await tx.execute<{ count: number }>(sql`
      WITH reaped AS (
        UPDATE outbox_entry
           SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
               available_at = now(), updated_at = now()
         WHERE status = 'leased'
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
        RETURNING id
      )
      SELECT count(*)::int AS count FROM reaped
    `);
    return Number([...rows][0]?.count ?? 0);
  });
  if (reaped > 0) log.warn({ reaped }, "orphaned outbox leases returned to pending");
  return reaped;
}
