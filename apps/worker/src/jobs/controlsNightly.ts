import type { Tx } from "@lfsci/db";
import { ensureObjectRef, purgeExchanges, tables, withoutTenant, withTenant } from "@lfsci/db";
import { logger } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.controls.nightly");

export const EXCHANGE_RETENTION_DAYS = 30;
export const SAMPLE_SIZE = 5;

export const ControlsNightlyData = JobBase.extend({});
export type ControlsNightlyData = z.infer<typeof ControlsNightlyData>;

export type ControlStatus = "ok" | "anomalies" | "failed";
export type ControlResult = {
  name: string;
  status: ControlStatus;
  count: number;
  sample: string[];
};

type Probe = { name: string; query: (tx: Tx) => Promise<{ id: string }[]> };

/** OPS-02, restricted to what the current schema can actually express. */
const probes: Probe[] = [
  {
    name: "rent_terms_without_version",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT t.id FROM rent_term t WHERE t.current_version_id IS NULL ORDER BY t.due_on LIMIT 200`,
      ),
  },
  {
    name: "payments_unallocated",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT p.id FROM payment p
             LEFT JOIN payment_allocation a ON a.payment_id = p.id AND a.reversed_at IS NULL
            WHERE a.id IS NULL AND p.status <> 'rejected'
            ORDER BY p.received_on LIMIT 200`,
      ),
  },
  {
    name: "expense_lines_without_allocation",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT l.id FROM expense_line l
             LEFT JOIN expense_allocation a ON a.expense_line_id = l.id
            WHERE a.id IS NULL ORDER BY l.created_at LIMIT 200`,
      ),
  },
  {
    name: "commands_stuck_in_sent",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT id FROM command WHERE status = 'sent' AND updated_at < now() - interval '1 hour'
            ORDER BY updated_at LIMIT 200`,
      ),
  },
  {
    name: "commands_unknown_result_over_24h",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT id FROM command WHERE status = 'unknown_result' AND created_at < now() - interval '24 hours'
            ORDER BY created_at LIMIT 200`,
      ),
  },
  {
    name: "deadlines_overdue",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT id FROM deadline
            WHERE due_on < current_date AND status IN ('planned','to_process','postponed','blocked')
            ORDER BY due_on LIMIT 200`,
      ),
  },
  {
    name: "outbox_dead_letters",
    query: (tx) =>
      rows(
        tx,
        sql`SELECT id FROM outbox_entry WHERE status = 'dead_letter' ORDER BY updated_at DESC LIMIT 200`,
      ),
  },
];

async function rows(tx: Tx, query: ReturnType<typeof sql>): Promise<{ id: string }[]> {
  return [...(await tx.execute<{ id: string }>(query))];
}

export async function runControls(deps: Deps, organizationId: string): Promise<ControlResult[]> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const results: ControlResult[] = [];
    for (const probe of probes) {
      try {
        const found = await probe.query(tx);
        results.push({
          name: probe.name,
          status: found.length === 0 ? "ok" : "anomalies",
          count: found.length,
          sample: found.slice(0, SAMPLE_SIZE).map((row) => row.id),
        });
      } catch (error) {
        log.error({ probe: probe.name, organizationId, err: error }, "control failed");
        results.push({ name: probe.name, status: "failed", count: 0, sample: [] });
      }
    }
    return results;
  });
}

/** The report is an `event` on the organization's first legal entity (MOD-01). */
async function persistReport(
  deps: Deps,
  organizationId: string,
  report: {
    runAt: string;
    expected: number;
    executed: number;
    failed: string[];
    controls: ControlResult[];
  },
): Promise<boolean> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const entities = await tx
      .select({ id: tables.legalEntity.id })
      .from(tables.legalEntity)
      .limit(1);
    const entity = entities[0];
    if (!entity) return false;
    const objectRefId = await ensureObjectRef(tx, {
      organizationId,
      kind: "legal_entity",
      id: entity.id,
    });
    await tx.insert(tables.event).values({
      organizationId,
      type: "control_run",
      primaryObjectRefId: objectRefId,
      occurredAt: report.runAt,
      origin: "rule",
      payload: report,
    });
    return true;
  });
}

export async function nightlyControls(deps: Deps): Promise<JobOutcome> {
  const runAt = deps.now().toISOString();
  const organizationIds = await forEachOrganizationId(deps);
  const perOrganization: { organizationId: string; controls: ControlResult[] }[] = [];

  for (const organizationId of organizationIds) {
    const controls = await runControls(deps, organizationId);
    perOrganization.push({ organizationId, controls });
    const failed = controls.filter((c) => c.status === "failed").map((c) => c.name);
    await persistReport(deps, organizationId, {
      runAt,
      expected: probes.length,
      executed: controls.length - failed.length,
      failed,
      controls,
    });
  }

  const all = perOrganization.flatMap((entry) => entry.controls);
  const failedCount = all.filter((control) => control.status === "failed").length;
  if (all.length > 0 && failedCount === all.length) {
    // Global rule: an all-calls-failed run is a failure and advances nothing.
    throw new Error(`every nightly control failed across ${organizationIds.length} organizations`);
  }

  const purged = await withoutTenant(deps.admin, (tx) =>
    purgeExchanges(tx, EXCHANGE_RETENTION_DAYS),
  );

  return {
    outcome: "completed",
    runAt,
    organizations: organizationIds.length,
    expected: probes.length * organizationIds.length,
    executed: all.length - failedCount,
    failed: failedCount,
    anomalies: all.filter((control) => control.status === "anomalies").length,
    exchangesPurged: purged,
  };
}

export const controlsNightly = defineJob({
  name: "controls.nightly",
  schema: ControlsNightlyData,
  options: {
    retryLimit: 1,
    retryDelay: 600,
    retryBackoff: false,
    expireInSeconds: 1800,
    localConcurrency: 1,
  },
  schedule: { cron: "30 2 * * *", tz: "Europe/Paris" },
  handler: (_data, deps) => nightlyControls(deps),
});
