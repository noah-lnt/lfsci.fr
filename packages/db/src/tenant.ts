import { AppError, currentCorrelation } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { Db, DbHandle, Tx } from "./client";
import { DEFAULT_APP_ROLE } from "./client";

export type TenantContext = {
  organizationId: string;
  actorId?: string;
  requestId?: string;
  /** Overrides the handle's role; null runs the transaction as the connection user. */
  appRole?: string | null;
};

const identifier = /^[a-z_][a-z0-9_]*$/;

export async function withTenant<T>(
  target: Db | DbHandle,
  context: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const db = "db" in target ? target.db : target;
  const role =
    context.appRole !== undefined
      ? context.appRole
      : "appRole" in target
        ? target.appRole
        : DEFAULT_APP_ROLE;
  const correlation = currentCorrelation();
  const actorId = context.actorId ?? correlation?.actorId;
  const requestId = context.requestId ?? correlation?.requestId;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.organization_id', ${context.organizationId}, true)`,
    );
    if (actorId) {
      await tx.execute(sql`SELECT set_config('app.actor_id', ${actorId}, true)`);
    }
    if (requestId) {
      await tx.execute(sql`SELECT set_config('app.request_id', ${requestId}, true)`);
    }
    if (role) {
      if (!identifier.test(role)) {
        throw new AppError("INTERNAL", { message: `invalid database role: ${role}` });
      }
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
    }
    return fn(tx);
  });
}

/** Admin path: migrations, cross-organization loops, purges. No tenant setting, no role switch. */
export async function withoutTenant<T>(
  target: Db | DbHandle,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const db = "db" in target ? target.db : target;
  return db.transaction(async (tx) => fn(tx));
}

export async function listOrganizationIds(target: Db | DbHandle): Promise<string[]> {
  const db = "db" in target ? target.db : target;
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM organization WHERE status = 'active' ORDER BY code`,
  );
  return [...rows].map((row) => row.id);
}

/** Runs fn once per active organization, each in its own tenant transaction. */
export async function forEachOrganization<T>(
  handle: DbHandle,
  fn: (tx: Tx, organizationId: string) => Promise<T>,
): Promise<{ organizationId: string; result: T }[]> {
  const ids = await listOrganizationIds(handle);
  const out: { organizationId: string; result: T }[] = [];
  for (const organizationId of ids) {
    const result = await withTenant(handle, { organizationId }, (tx) => fn(tx, organizationId));
    out.push({ organizationId, result });
  }
  return out;
}
