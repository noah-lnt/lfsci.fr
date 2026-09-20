import { createCommand, enqueueOutbox, tables, withTenant } from "@lfsci/db";
import {
  addMonthsIso,
  generateRentTerms,
  type LeaseTerms,
  monthEndOf,
  monthStartOf,
  type RentVersion,
} from "@lfsci/domain";
import { logger } from "@lfsci/kernel";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.rent.prepareTerms");

export const RentPrepareTermsData = JobBase.extend({
  /** Any date inside the month to prepare; the schedule leaves it out. */
  month: z.iso.date().optional(),
});
export type RentPrepareTermsData = z.infer<typeof RentPrepareTermsData>;

export type OrganizationReport = {
  organizationId: string;
  leases: number;
  expected: number;
  created: number;
  commands: number;
};

function versionsOf(
  lease: typeof tables.lease.$inferSelect,
  rows: (typeof tables.leaseVersion.$inferSelect)[],
): RentVersion[] {
  const chargeKind = lease.chargeRegime === "flat_fee" ? "flat" : "provision";
  if (rows.length === 0) {
    return [
      {
        effectiveFrom: lease.startsOn ?? "1970-01-01",
        rentExclCharges: lease.rentExclCharges ?? "0",
        charges: { kind: chargeKind, amount: lease.chargeAmount ?? "0" },
      },
    ];
  }
  return rows.map((row) => ({
    effectiveFrom: row.effectiveOn,
    rentExclCharges: row.rentExclCharges ?? lease.rentExclCharges ?? "0",
    charges: { kind: chargeKind, amount: row.chargeAmount ?? lease.chargeAmount ?? "0" },
  }));
}

export async function prepareTermsForOrganization(
  deps: Deps,
  organizationId: string,
  month: string,
): Promise<OrganizationReport> {
  const windowStart = monthStartOf(month);
  const windowEnd = monthEndOf(month);

  return withTenant(deps.db, { organizationId }, async (tx) => {
    const leases = await tx.select().from(tables.lease).where(eq(tables.lease.status, "active"));
    if (leases.length === 0) {
      return { organizationId, leases: 0, expected: 0, created: 0, commands: 0 };
    }

    const leaseIds = leases.map((lease) => lease.id);
    const versions = await tx
      .select()
      .from(tables.leaseVersion)
      .where(inArray(tables.leaseVersion.leaseId, leaseIds))
      .orderBy(asc(tables.leaseVersion.sequence));

    let expected = 0;
    let created = 0;
    let commands = 0;

    for (const lease of leases) {
      if (!lease.startsOn) continue;
      const input: LeaseTerms = {
        leaseId: lease.id,
        start: lease.startsOn,
        ...(lease.endsOn ? { end: lease.endsOn } : {}),
        dueDay: lease.paymentDay ?? 1,
        versions: versionsOf(
          lease,
          versions.filter((version) => version.leaseId === lease.id),
        ),
      };
      const terms = generateRentTerms(input, { start: windowStart, end: windowEnd });
      expected += terms.length;

      for (const term of terms) {
        // Idempotent on the natural key (lease_id, kind, period_start).
        const inserted = await tx
          .insert(tables.rentTerm)
          .values({
            organizationId,
            leaseId: lease.id,
            kind: "rent",
            periodStart: term.periodStart,
            periodEnd: term.periodEnd,
            dueOn: term.dueDate,
            status: "planned",
          })
          .onConflictDoNothing()
          .returning({ id: tables.rentTerm.id });
        const row = inserted[0];
        if (!row) continue;
        created += 1;

        const versionRows = await tx
          .insert(tables.rentTermVersion)
          .values({
            organizationId,
            rentTermId: row.id,
            sequence: 1,
            rentAmount: term.rent,
            chargeAmount: term.charges,
            accessoryAmount: "0",
            totalAmount: term.total,
            currency: lease.currency,
            reason: term.prorated ? "proration" : "initial",
          })
          .returning({ id: tables.rentTermVersion.id });
        const versionRow = versionRows[0];
        if (versionRow) {
          await tx
            .update(tables.rentTerm)
            .set({ currentVersionId: versionRow.id })
            .where(eq(tables.rentTerm.id, row.id));
        }

        // Decision level C (§17.1): prepared, never authorized on its own.
        const command = await createCommand(tx, {
          organizationId,
          commandType: "prepare_rent_accounting",
          operationKey: `prepare_rent_accounting:${row.id}`,
          payload: {
            rentTermId: row.id,
            kind: "rent",
            periodStart: term.periodStart,
            periodEnd: term.periodEnd,
            dueOn: term.dueDate,
            rentAmount: term.rent,
            chargeAmount: term.charges,
            accessoryAmount: "0",
            totalAmount: term.total,
            currency: lease.currency,
          },
          autonomyLevel: "C",
          status: "prepared",
        });
        await enqueueOutbox(tx, {
          organizationId,
          kind: "odoo",
          commandId: command.id,
          payload: command.payload,
          payloadHash: command.payloadHash,
          // Not runnable until a human authorizes it; far-future availability
          // keeps it out of every claim until the authorization moves it.
          availableAt: new Date(Date.UTC(2999, 0, 1)).toISOString(),
        });
        commands += 1;
      }
    }

    return { organizationId, leases: leases.length, expected, created, commands };
  });
}

export async function prepareTerms(deps: Deps, data: RentPrepareTermsData): Promise<JobOutcome> {
  const month = data.month ?? monthStartOf(addMonthsIso(isoToday(deps), 1));
  const reports: OrganizationReport[] = [];
  const failures: string[] = [];

  for (const organizationId of await forEachOrganizationId(deps)) {
    try {
      reports.push(await prepareTermsForOrganization(deps, organizationId, month));
    } catch (error) {
      failures.push(`${organizationId}: ${error instanceof Error ? error.message : String(error)}`);
      log.error({ organizationId, err: error }, "rent term preparation failed");
    }
  }

  if (reports.length === 0 && failures.length > 0) {
    throw new Error(`rent term preparation failed for every organization: ${failures.join("; ")}`);
  }

  return {
    outcome: "prepared",
    month,
    organizations: reports.length,
    expected: reports.reduce((total, report) => total + report.expected, 0),
    created: reports.reduce((total, report) => total + report.created, 0),
    commands: reports.reduce((total, report) => total + report.commands, 0),
    failures,
  };
}

function isoToday(deps: Deps): string {
  return deps.now().toISOString().slice(0, 10);
}

export const rentPrepareTerms = defineJob({
  name: "rent.prepareTerms",
  schema: RentPrepareTermsData,
  options: {
    retryLimit: 2,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 1800,
    localConcurrency: 1,
  },
  schedule: { cron: "0 6 1 * *", tz: "Europe/Paris" },
  handler: (data, deps) => prepareTerms(deps, data),
});
