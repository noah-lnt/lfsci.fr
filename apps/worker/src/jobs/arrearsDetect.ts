import type { Tx } from "@lfsci/db";
import { ensureObjectRef, linkDeadline, tables, withTenant } from "@lfsci/db";
import {
  type ArrearsQualification,
  DEFAULT_REMINDER_POLICY,
  daysLate,
  gradeReminder,
  outstandingOf,
  qualifyArrears,
  type ReminderLevel,
} from "@lfsci/domain";
import { logger } from "@lfsci/kernel";
import { reminderTemplateCodes } from "@lfsci/mail";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { deterministicDeadlineId } from "./deadlinesGenerate";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.arrears.detect");

export const ARREARS_RULE = "rent_arrears";
export const ARREARS_DEADLINE_TYPE = "rent_arrears";
export const LEDGER_CONNECTOR = "odoo";
export const TERM_LIMIT = 500;

export const ArrearsDetectData = JobBase.extend({
  /** Any civil date; the schedule leaves it out and the job uses today in Paris. */
  asOf: z.iso.date().optional(),
});
export type ArrearsDetectData = z.infer<typeof ArrearsDetectData>;

const levelByTemplateCode = new Map<string, ReminderLevel>(
  (Object.entries(reminderTemplateCodes) as [ReminderLevel, string][]).map(([level, code]) => [
    code,
    level,
  ]),
);

const QUALIFICATION_RANK: Record<ArrearsQualification, number> = {
  due: 0,
  unapplied_receipt: 1,
  payment_in_transit: 2,
  sync_incident: 3,
  disputed: 4,
};

export type ArrearsTerm = {
  rentTermId: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  total: string;
  allocated: string;
  outstanding: string;
  qualification: ArrearsQualification;
};

export type LeaseArrears = {
  leaseId: string;
  leaseReference: string;
  leaseStatus: string;
  currency: string;
  tenantPersonId: string | null;
  tenantName: string | null;
  tenantEmail: string | null;
  oldestDueOn: string;
  daysLate: number;
  outstanding: string;
  qualification: ArrearsQualification;
  suspended: boolean;
  lastLevel: ReminderLevel | null;
  lastSentOn: string | null;
  terms: ArrearsTerm[];
};

async function rows<T extends Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return [...(await tx.execute<T>(query))] as T[];
}

type TermRaw = {
  rent_term_id: string;
  lease_id: string;
  lease_reference: string;
  lease_status: string;
  currency: string;
  term_status: string;
  period_start: string;
  period_end: string;
  due_on: string;
  total_amount: string | null;
  allocated: string;
  pending_allocated: string;
};

async function overdueTerms(tx: Tx, asOf: string): Promise<TermRaw[]> {
  return rows<TermRaw>(
    tx,
    sql`SELECT t.id AS rent_term_id, t.lease_id, l.reference AS lease_reference,
               l.status AS lease_status, COALESCE(v.currency, l.currency) AS currency,
               t.status AS term_status,
               to_char(t.period_start, 'YYYY-MM-DD') AS period_start,
               to_char(t.period_end, 'YYYY-MM-DD') AS period_end,
               to_char(t.due_on, 'YYYY-MM-DD') AS due_on,
               v.total_amount,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL), 0)::text
                 AS allocated,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL
                            AND a.confirmed_by_odoo = false), 0)::text AS pending_allocated
          FROM rent_term t
          JOIN lease l ON l.id = t.lease_id
          LEFT JOIN rent_term_version v ON v.id = t.current_version_id
         WHERE t.due_on < ${asOf}::date
           AND t.status NOT IN ('settled', 'cancelled')
         ORDER BY t.due_on, t.id
         LIMIT ${TERM_LIMIT}`,
  );
}

/** LOY-02: a sum received but not allocated is a credit to qualify, not a settled term. */
async function unappliedCreditByLease(tx: Tx): Promise<Map<string, string>> {
  const found = await rows<{ lease_id: string; unapplied: string }>(
    tx,
    sql`SELECT lp.lease_id,
               sum(GREATEST(p.amount - COALESCE(alloc.total, 0), 0))::text AS unapplied
          FROM payment p
          JOIN lease_party lp ON lp.person_id = p.payer_person_id
          LEFT JOIN LATERAL (
                 SELECT sum(a.amount) AS total FROM payment_allocation a
                  WHERE a.payment_id = p.id AND a.reversed_at IS NULL
               ) alloc ON TRUE
         WHERE p.direction = 'inbound'
           AND p.status IN ('to_qualify', 'partially_allocated', 'overpaid')
         GROUP BY lp.lease_id`,
  );
  return new Map(found.map((row) => [row.lease_id, row.unapplied]));
}

async function ledgerFreshness(
  tx: Tx,
  asOf: string,
): Promise<{ healthy: boolean; staleDays: number | null }> {
  const found = await rows<{ health: string; success_on: string | null }>(
    tx,
    sql`SELECT health, to_char(last_success_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS success_on
          FROM integration_cursor
         WHERE connector = ${LEDGER_CONNECTOR}
         ORDER BY last_success_at DESC NULLS LAST
         LIMIT 1`,
  );
  const row = found[0];
  // No cursor at all: the ledger is not wired yet, which is not a sync incident.
  if (!row) return { healthy: true, staleDays: null };
  return {
    healthy: row.health === "healthy" || row.health === "degraded",
    staleDays: row.success_on === null ? null : daysLate(row.success_on, asOf),
  };
}

type TenantRaw = {
  lease_id: string;
  person_id: string;
  display_name: string;
  email: string | null;
};

async function tenantByLease(tx: Tx): Promise<Map<string, TenantRaw>> {
  const found = await rows<TenantRaw>(
    tx,
    sql`SELECT DISTINCT ON (lp.lease_id)
               lp.lease_id, p.id AS person_id, p.display_name,
               (SELECT c.value FROM contact_point c
                 WHERE c.person_id = p.id AND c.kind = 'email' AND c.status = 'active'
                 ORDER BY c.is_primary DESC, c.created_at
                 LIMIT 1) AS email
          FROM lease_party lp
          JOIN person p ON p.id = lp.person_id
         WHERE lp.role IN ('holder', 'co_holder')
           AND (lp.ends_on IS NULL OR lp.ends_on >= current_date)
         ORDER BY lp.lease_id, lp.is_billing_contact DESC, lp.role, lp.starts_on`,
  );
  return new Map(found.map((row) => [row.lease_id, row]));
}

type ReminderRaw = { lease_id: string; template_code: string; sent_on: string };

async function lastReminderByLease(
  tx: Tx,
): Promise<Map<string, { level: ReminderLevel; sentOn: string }>> {
  const codes = [...levelByTemplateCode.keys()];
  const found = await rows<ReminderRaw>(
    tx,
    sql`SELECT DISTINCT ON (o.lease_id) o.lease_id, m.template_code,
               to_char(COALESCE(m.first_attempt_at, m.created_at) AT TIME ZONE 'Europe/Paris',
                       'YYYY-MM-DD') AS sent_on
          FROM message_outbound m
          JOIN object_ref o ON o.id = m.related_object_ref_id
         WHERE o.lease_id IS NOT NULL
           AND m.status IN ('sent', 'delivered')
           AND m.template_code IN (${sql.join(
             codes.map((code) => sql`${code}`),
             sql`, `,
           )})
         ORDER BY o.lease_id, COALESCE(m.first_attempt_at, m.created_at) DESC`,
  );
  const out = new Map<string, { level: ReminderLevel; sentOn: string }>();
  for (const row of found) {
    const level = levelByTemplateCode.get(row.template_code);
    if (level) out.set(row.lease_id, { level, sentOn: row.sent_on });
  }
  return out;
}

/** LOY-04 read side: what is due and unpaid, and why the automation may not run. */
export async function collectArrears(
  deps: Deps,
  organizationId: string,
  asOf: string,
): Promise<LeaseArrears[]> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const terms = await overdueTerms(tx, asOf);
    if (terms.length === 0) return [];

    const credits = await unappliedCreditByLease(tx);
    const ledger = await ledgerFreshness(tx, asOf);
    const tenants = await tenantByLease(tx);
    const reminders = await lastReminderByLease(tx);

    const byLease = new Map<string, LeaseArrears>();
    for (const raw of terms) {
      const outstanding = outstandingOf({
        total: raw.total_amount ?? "0",
        allocated: raw.allocated,
      });
      if (Number(outstanding) <= 0) continue;

      const qualification = qualifyArrears({
        termStatus: raw.term_status,
        leaseStatus: raw.lease_status,
        pendingAllocated: raw.pending_allocated,
        unappliedCredit: credits.get(raw.lease_id) ?? "0",
        ledgerStaleDays: ledger.staleDays,
        ledgerHealthy: ledger.healthy,
      });

      const term: ArrearsTerm = {
        rentTermId: raw.rent_term_id,
        periodStart: raw.period_start,
        periodEnd: raw.period_end,
        dueOn: raw.due_on,
        total: raw.total_amount ?? "0.00",
        allocated: raw.allocated,
        outstanding,
        qualification,
      };

      const existing = byLease.get(raw.lease_id);
      if (existing) {
        existing.terms.push(term);
        existing.outstanding = (Number(existing.outstanding) + Number(outstanding)).toFixed(2);
        if (term.dueOn < existing.oldestDueOn) existing.oldestDueOn = term.dueOn;
        if (QUALIFICATION_RANK[qualification] > QUALIFICATION_RANK[existing.qualification]) {
          existing.qualification = qualification;
        }
        continue;
      }

      const tenant = tenants.get(raw.lease_id);
      const reminder = reminders.get(raw.lease_id);
      byLease.set(raw.lease_id, {
        leaseId: raw.lease_id,
        leaseReference: raw.lease_reference,
        leaseStatus: raw.lease_status,
        currency: raw.currency,
        tenantPersonId: tenant?.person_id ?? null,
        tenantName: tenant?.display_name ?? null,
        tenantEmail: tenant?.email ?? null,
        oldestDueOn: term.dueOn,
        daysLate: 0,
        outstanding,
        qualification,
        suspended: false,
        lastLevel: reminder?.level ?? null,
        lastSentOn: reminder?.sentOn ?? null,
        terms: [term],
      });
    }

    return [...byLease.values()]
      .map((lease) => {
        const decision = gradeReminder({
          today: asOf,
          dueOn: lease.oldestDueOn,
          outstanding: lease.outstanding,
          qualification: lease.qualification,
          lastLevel: lease.lastLevel,
          lastSentOn: lease.lastSentOn,
        });
        return {
          ...lease,
          daysLate: decision.daysLate,
          suspended: lease.qualification !== "due",
        };
      })
      .sort((a, b) => a.oldestDueOn.localeCompare(b.oldestDueOn));
  });
}

async function upsertDeadline(
  tx: Tx,
  organizationId: string,
  lease: LeaseArrears,
): Promise<boolean> {
  const id = deterministicDeadlineId(ARREARS_RULE, "lease", lease.leaseId, lease.oldestDueOn);
  const title = `Impayé — bail ${lease.leaseReference} : ${lease.outstanding} ${lease.currency}`;
  const priority = lease.daysLate >= DEFAULT_REMINDER_POLICY.formalNoticeDays ? "critical" : "high";

  const inserted = await tx
    .insert(tables.deadline)
    .values({
      id,
      organizationId,
      type: ARREARS_DEADLINE_TYPE,
      title,
      dueOn: lease.oldestDueOn,
      priority,
      status: "to_process",
    })
    .onConflictDoNothing()
    .returning({ id: tables.deadline.id });

  if (inserted[0]) {
    const objectRefId = await ensureObjectRef(tx, {
      organizationId,
      kind: "lease",
      id: lease.leaseId,
    });
    await linkDeadline(tx, { organizationId, deadlineId: id, objectRefId });
    return true;
  }

  // Only a real change writes: two runs on the same day must leave the row alone.
  const updated = await tx
    .update(tables.deadline)
    .set({ title, priority, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.deadline.id, id),
        sql`(${tables.deadline.title} IS DISTINCT FROM ${title}
             OR ${tables.deadline.priority} IS DISTINCT FROM ${priority})`,
      ),
    )
    .returning({ id: tables.deadline.id });
  return updated.length > 0;
}

/** An arrear that disappeared closes its deadline; it never lingers as an open task. */
async function cancelSettledDeadlines(tx: Tx, openIds: readonly string[]): Promise<number> {
  const keep =
    openIds.length === 0
      ? sql``
      : sql`AND id NOT IN (${sql.join(
          openIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const closed = await rows<{ id: string }>(
    tx,
    sql`UPDATE deadline
           SET status = 'cancelled',
               cancelled_reason = 'impayé régularisé',
               updated_at = now()
         WHERE type = ${ARREARS_DEADLINE_TYPE}
           AND status IN ('planned', 'to_process', 'postponed', 'blocked')
           ${keep}
        RETURNING id`,
  );
  return closed.length;
}

/**
 * LOY-04: an ambiguous payment, a disputed file or a stale ledger suspends the
 * reminder ladder and surfaces as an exception the owner reads, never as a
 * silent skip.
 */
async function openException(
  tx: Tx,
  organizationId: string,
  lease: LeaseArrears,
): Promise<boolean> {
  const reference = `arrears:${lease.leaseId}:${lease.qualification}:${lease.oldestDueOn}`;
  const existing = await tx
    .select({ id: tables.inboxItem.id })
    .from(tables.inboxItem)
    .where(
      and(
        eq(tables.inboxItem.source, "connector"),
        eq(tables.inboxItem.sourceReference, reference),
      ),
    )
    .limit(1);
  if (existing[0]) return false;

  const objectRefId = await ensureObjectRef(tx, {
    organizationId,
    kind: "lease",
    id: lease.leaseId,
  });
  await tx.insert(tables.event).values({
    organizationId,
    type: "arrears_suspended",
    primaryObjectRefId: objectRefId,
    occurredAt: new Date().toISOString(),
    origin: "rule",
    payload: {
      leaseId: lease.leaseId,
      qualification: lease.qualification,
      outstanding: lease.outstanding,
      currency: lease.currency,
      oldestDueOn: lease.oldestDueOn,
    },
  });
  await tx.insert(tables.inboxItem).values({
    organizationId,
    source: "connector",
    sourceReference: reference,
    proposedObjectRefId: objectRefId,
    proposedAction: "review_arrears_suspension",
    uncertaintyReason:
      `Relance suspendue sur le bail ${lease.leaseReference} : ${lease.qualification}.`.slice(
        0,
        500,
      ),
    status: "ambiguous",
  });
  return true;
}

export type ArrearsReport = {
  organizationId: string;
  leases: number;
  outstanding: string;
  deadlinesWritten: number;
  deadlinesClosed: number;
  exceptionsOpened: number;
  suspended: number;
};

export async function detectForOrganization(
  deps: Deps,
  organizationId: string,
  asOf: string,
): Promise<ArrearsReport> {
  const arrears = await collectArrears(deps, organizationId, asOf);

  const written = await withTenant(deps.db, { organizationId }, async (tx) => {
    let deadlinesWritten = 0;
    let exceptionsOpened = 0;
    const openIds: string[] = [];
    for (const lease of arrears) {
      openIds.push(
        deterministicDeadlineId(ARREARS_RULE, "lease", lease.leaseId, lease.oldestDueOn),
      );
      if (await upsertDeadline(tx, organizationId, lease)) deadlinesWritten += 1;
      if (lease.suspended && (await openException(tx, organizationId, lease))) {
        exceptionsOpened += 1;
      }
    }
    const deadlinesClosed = await cancelSettledDeadlines(tx, openIds);
    return { deadlinesWritten, exceptionsOpened, deadlinesClosed };
  });

  return {
    organizationId,
    leases: arrears.length,
    outstanding: arrears.reduce((total, lease) => total + Number(lease.outstanding), 0).toFixed(2),
    suspended: arrears.filter((lease) => lease.suspended).length,
    ...written,
  };
}

export async function detectArrears(deps: Deps, data: ArrearsDetectData): Promise<JobOutcome> {
  const asOf = data.asOf ?? deps.now().toISOString().slice(0, 10);
  const reports: ArrearsReport[] = [];
  const failures: string[] = [];

  for (const organizationId of await forEachOrganizationId(deps)) {
    try {
      reports.push(await detectForOrganization(deps, organizationId, asOf));
    } catch (error) {
      failures.push(`${organizationId}: ${error instanceof Error ? error.message : String(error)}`);
      log.error({ organizationId, err: error }, "arrears detection failed");
    }
  }

  if (reports.length === 0 && failures.length > 0) {
    throw new Error(`arrears detection failed for every organization: ${failures.join("; ")}`);
  }

  return {
    outcome: "detected",
    asOf,
    organizations: reports.length,
    leases: reports.reduce((total, report) => total + report.leases, 0),
    suspended: reports.reduce((total, report) => total + report.suspended, 0),
    deadlinesWritten: reports.reduce((total, report) => total + report.deadlinesWritten, 0),
    deadlinesClosed: reports.reduce((total, report) => total + report.deadlinesClosed, 0),
    exceptionsOpened: reports.reduce((total, report) => total + report.exceptionsOpened, 0),
    failures,
  };
}

export const arrearsDetect = defineJob({
  name: "arrears.detect",
  schema: ArrearsDetectData,
  options: {
    retryLimit: 2,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 900,
    localConcurrency: 1,
  },
  schedule: { cron: "15 6 * * *", tz: "Europe/Paris" },
  handler: (data, deps) => detectArrears(deps, data),
});
