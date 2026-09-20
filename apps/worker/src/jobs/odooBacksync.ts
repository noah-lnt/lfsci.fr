import { ensureObjectRef, mapExternal, tables, withTenant } from "@lfsci/db";
import { logger, toAppError } from "@lfsci/kernel";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { withExchangeContext } from "../exchange-recorder";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.odoo.backsync");

export const CONNECTOR = "odoo";
export const STREAM = "account.move";
export const PAGE_LIMIT = 200;

export const OdooBacksyncData = JobBase.extend({});
export type OdooBacksyncData = z.infer<typeof OdooBacksyncData>;

async function readCursor(deps: Deps, organizationId: string): Promise<string | undefined> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select({ cursorValue: tables.integrationCursor.cursorValue })
      .from(tables.integrationCursor)
      .where(
        and(
          eq(tables.integrationCursor.connector, CONNECTOR),
          eq(tables.integrationCursor.stream, STREAM),
        ),
      )
      .limit(1);
    return rows[0]?.cursorValue ?? undefined;
  });
}

async function saveCursor(
  deps: Deps,
  organizationId: string,
  patch: { cursorValue?: string; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  await withTenant(deps.db, { organizationId }, async (tx) => {
    const base = {
      organizationId,
      connector: CONNECTOR,
      stream: STREAM,
      cursorKind: "write_date_id" as const,
      overlapSeconds: 600,
      lastAttemptAt: now,
    };
    const success = patch.error === undefined;
    await tx
      .insert(tables.integrationCursor)
      .values({
        ...base,
        cursorValue: patch.cursorValue ?? null,
        lastSuccessAt: success ? now : null,
        lastError: patch.error ?? null,
        consecutiveFailures: success ? 0 : 1,
        health: success ? "healthy" : "degraded",
      })
      .onConflictDoUpdate({
        target: [
          tables.integrationCursor.organizationId,
          tables.integrationCursor.connector,
          tables.integrationCursor.stream,
        ],
        set: {
          lastAttemptAt: now,
          ...(patch.cursorValue === undefined ? {} : { cursorValue: patch.cursorValue }),
          ...(success
            ? { lastSuccessAt: now, lastError: null, consecutiveFailures: 0, health: "healthy" }
            : { lastError: patch.error ?? null, health: "degraded" }),
          updatedAt: now,
        },
      });
  });
}

export async function backsyncOrganization(
  deps: Deps,
  organizationId: string,
): Promise<{ read: number; advanced: boolean }> {
  const odoo = deps.odoo;
  if (!odoo) return { read: 0, advanced: false };

  const cursor = await readCursor(deps, organizationId);
  const page = await withExchangeContext({ organizationId, commandId: null }, () =>
    odoo.operations.readAccountMoves(undefined, cursor, { limit: PAGE_LIMIT }),
  );
  if (page.records.length === 0) {
    await saveCursor(deps, organizationId, {});
    return { read: 0, advanced: false };
  }

  // The cursor advances only after the whole page is persisted (SYN-04).
  await withTenant(deps.db, { organizationId }, async (tx) => {
    const entities = await tx
      .select({ id: tables.legalEntity.id })
      .from(tables.legalEntity)
      .limit(1);
    const entity = entities[0];
    const objectRefId = entity
      ? await ensureObjectRef(tx, { organizationId, kind: "legal_entity", id: entity.id })
      : null;

    for (const move of page.records) {
      const existing = await tx
        .select({ id: tables.externalRef.id })
        .from(tables.externalRef)
        .where(
          and(
            eq(tables.externalRef.model, "account.move"),
            eq(tables.externalRef.externalId, String(move.id)),
          ),
        )
        .limit(1);
      if (!existing[0] && objectRefId) {
        await mapExternal(tx, {
          organizationId,
          model: "account.move",
          externalId: move.id,
          internalId: entity?.id ?? "",
          internalTable: "legal_entity",
          odooDatabase: odoo.database,
          objectRefId,
        }).catch((error: unknown) => {
          log.debug({ moveId: move.id, err: toAppError(error).code }, "move not mapped");
        });
      }
      if (!objectRefId) continue;
      await tx.insert(tables.event).values({
        organizationId,
        type: "odoo_move_changed",
        primaryObjectRefId: objectRefId,
        occurredAt: new Date().toISOString(),
        origin: "odoo",
        payload: {
          odooId: move.id,
          name: move.name,
          state: move.state,
          moveType: move.move_type,
          amountTotal: move.amount_total,
          amountResidual: move.amount_residual,
          writeDate: move.write_date,
        },
      });
    }
  });

  if (page.nextCursor) await saveCursor(deps, organizationId, { cursorValue: page.nextCursor });
  return { read: page.records.length, advanced: Boolean(page.nextCursor) };
}

export async function backsync(deps: Deps): Promise<JobOutcome> {
  if (!deps.odoo) return { outcome: "sources_unavailable", missing: ["odoo"] };

  const organizationIds = await forEachOrganizationId(deps);
  let read = 0;
  const failures: string[] = [];

  for (const organizationId of organizationIds) {
    try {
      const result = await backsyncOrganization(deps, organizationId);
      read += result.read;
    } catch (error) {
      const appError = toAppError(error);
      failures.push(`${organizationId}: ${appError.code}`);
      await saveCursor(deps, organizationId, { error: appError.message.slice(0, 500) });
    }
  }

  if (organizationIds.length > 0 && failures.length === organizationIds.length) {
    throw new Error(`odoo back-sync failed everywhere: ${failures.join("; ")}`);
  }
  return { outcome: "synced", organizations: organizationIds.length, read, failures };
}

export const odooBacksync = defineJob({
  name: "odoo.backsync",
  schema: OdooBacksyncData,
  options: {
    retryLimit: 2,
    retryDelay: 120,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 900,
    localConcurrency: 1,
  },
  schedule: { cron: "*/10 * * * *", tz: "Europe/Paris" },
  handler: (_data, deps) => backsync(deps),
});
