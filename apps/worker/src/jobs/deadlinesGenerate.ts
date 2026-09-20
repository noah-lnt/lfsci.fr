import { createHash } from "node:crypto";
import { ensureObjectRef, linkDeadline, tables, withTenant } from "@lfsci/db";
import { addMonthsIso } from "@lfsci/domain";
import { logger } from "@lfsci/kernel";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.deadlines.generate");

export const HORIZON_MONTHS = 12;
export const METER_READING_INTERVAL_MONTHS = 12;

export const DeadlinesGenerateData = JobBase.extend({});
export type DeadlinesGenerateData = z.infer<typeof DeadlinesGenerateData>;

/**
 * `deadline` has no natural key, so identity is a UUIDv5-shaped digest of
 * (rule, object kind, object id, due date): the same source twice yields the
 * same primary key and the insert is a no-op (TMP-04, no duplicate reminders).
 */
export function deterministicDeadlineId(
  rule: string,
  kind: string,
  objectId: string,
  dueOn: string,
): string {
  const digest = createHash("sha1")
    .update(`lfsci:deadline:${rule}:${kind}:${objectId}:${dueOn}`)
    .digest("hex");
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  const variant = Number.parseInt(digest.slice(16, 17), 16);
  bytes[16] = ((variant & 0x3) | 0x8).toString(16);
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type DeadlineCandidate = {
  rule: string;
  kind: "lease" | "insurance_policy" | "equipment" | "meter";
  objectId: string;
  type: string;
  title: string;
  dueOn: string;
  priority: "low" | "normal" | "high" | "critical";
};

function withinHorizon(dueOn: string, today: string): boolean {
  return dueOn >= today && dueOn <= addMonthsIso(today, HORIZON_MONTHS);
}

/** The anniversary of `anchor` on or after `today`. */
export function nextAnniversary(anchor: string, today: string): string {
  const [, month = "01", day = "01"] = anchor.split("-");
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${month}-${day}`;
  return candidate >= today ? candidate : `${year + 1}-${month}-${day}`;
}

export async function collectCandidates(
  deps: Deps,
  organizationId: string,
  today: string,
): Promise<DeadlineCandidate[]> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const out: DeadlineCandidate[] = [];

    const leases = await tx.select().from(tables.lease).where(eq(tables.lease.status, "active"));
    for (const lease of leases) {
      if (!lease.startsOn || lease.revisionIndex === null || lease.revisionIndex === "none") {
        continue;
      }
      const dueOn = nextAnniversary(lease.startsOn, today);
      if (!withinHorizon(dueOn, today)) continue;
      out.push({
        rule: "lease_revision_anniversary",
        kind: "lease",
        objectId: lease.id,
        type: "rent_revision",
        title: `Révision du loyer — bail ${lease.reference}`,
        dueOn,
        priority: "normal",
      });
    }

    const policies = await tx
      .select()
      .from(tables.insurancePolicy)
      .where(eq(tables.insurancePolicy.status, "active"));
    for (const policy of policies) {
      if (!policy.endsOn || !withinHorizon(policy.endsOn, today)) continue;
      out.push({
        rule: "insurance_expiry",
        kind: "insurance_policy",
        objectId: policy.id,
        type: "insurance_renewal",
        title: `Échéance de la police ${policy.policyNumber}`,
        dueOn: policy.endsOn,
        priority: "high",
      });
    }

    const equipments = await tx
      .select()
      .from(tables.equipment)
      .where(eq(tables.equipment.status, "in_service"));
    for (const item of equipments) {
      const anchor = item.commissionedOn ?? item.purchasedOn;
      if (!anchor) continue;
      const dueOn = nextAnniversary(anchor, today);
      if (!withinHorizon(dueOn, today)) continue;
      out.push({
        rule: "equipment_maintenance",
        kind: "equipment",
        objectId: item.id,
        type: "equipment_maintenance",
        title: `Entretien — ${item.label}`,
        dueOn,
        priority: "normal",
      });
    }

    const meters = await tx.select().from(tables.meter).where(eq(tables.meter.status, "active"));
    for (const meter of meters) {
      const anchor = meter.installedOn;
      if (!anchor) continue;
      const dueOn = nextAnniversary(anchor, today);
      if (!withinHorizon(dueOn, today)) continue;
      out.push({
        rule: "meter_reading_due",
        kind: "meter",
        objectId: meter.id,
        type: "meter_reading",
        title: `Relevé du compteur ${meter.fluid}`,
        dueOn,
        priority: "low",
      });
    }

    return out;
  });
}

export async function generateDeadlines(deps: Deps): Promise<JobOutcome> {
  const today = deps.now().toISOString().slice(0, 10);
  let candidates = 0;
  let created = 0;

  for (const organizationId of await forEachOrganizationId(deps)) {
    const found = await collectCandidates(deps, organizationId, today);
    candidates += found.length;
    if (found.length === 0) continue;

    created += await withTenant(deps.db, { organizationId }, async (tx) => {
      let inserted = 0;
      for (const candidate of found) {
        const id = deterministicDeadlineId(
          candidate.rule,
          candidate.kind,
          candidate.objectId,
          candidate.dueOn,
        );
        const rows = await tx
          .insert(tables.deadline)
          .values({
            id,
            organizationId,
            type: candidate.type,
            title: candidate.title,
            dueOn: candidate.dueOn,
            priority: candidate.priority,
            status: "planned",
          })
          .onConflictDoNothing()
          .returning({ id: tables.deadline.id });
        if (!rows[0]) continue;
        inserted += 1;
        const objectRefId = await ensureObjectRef(tx, {
          organizationId,
          kind: candidate.kind,
          id: candidate.objectId,
        });
        await linkDeadline(tx, { organizationId, deadlineId: id, objectRefId });
      }
      return inserted;
    });
  }

  log.info({ candidates, created }, "deadlines generated");
  return { outcome: "generated", candidates, created, horizonMonths: HORIZON_MONTHS };
}

export const deadlinesGenerate = defineJob({
  name: "deadlines.generate",
  schema: DeadlinesGenerateData,
  options: {
    retryLimit: 2,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 900,
    localConcurrency: 1,
  },
  schedule: { cron: "0 5 * * *", tz: "Europe/Paris" },
  handler: (_data, deps) => generateDeadlines(deps),
});
