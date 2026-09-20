import "server-only";
import type { Tx } from "@lfsci/db";
import { createCommand, enqueueOutbox, ensureObjectRef, hashPayload, tables } from "@lfsci/db";
import {
  type ArrearsQualification,
  autonomyForReminder,
  DEFAULT_REMINDER_POLICY,
  daysLate,
  gradeReminder,
  outstandingOf,
  qualifyArrears,
  type ReminderLevel,
} from "@lfsci/domain";
import { reminderTemplateCodes, renderReminder } from "@lfsci/mail";
import { and, eq, sql } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import {
  type ArrearsRow,
  type ProposeReminderInput,
  type ProposeReminderResult,
  RecouvrementScreen,
  type ReminderHistoryEntry,
} from "@/lib/contracts/recouvrement";
import { tenant } from "../../data";
import { audit, recordFact } from "../../finance/facts";
import { amount, instant, ruleViolation, sumAmounts, today } from "../../finance/shared";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

const OPERATION_NAMESPACE = "3d8b1f5a-9c12-4c6d-9f4b-6a2e7c5d1b90";
const LEDGER_CONNECTOR = "odoo";
const TERM_LIMIT = 500;
/** Far-future availability parks the entry until an approval releases it (ARC-02). */
const PARKED_UNTIL = new Date(Date.UTC(2999, 0, 1)).toISOString();

type Scoped = RpcContext & { organizationId: string };
type Actor = { organizationId: string; actorUserId: string | null };

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

function actorOf(context: Scoped): Actor {
  return { organizationId: context.organizationId, actorUserId: context.session?.user.id ?? null };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

function operationKey(objectId: string): string {
  return uuidv5(`send_message:${objectId}`, OPERATION_NAMESPACE);
}

function dedupKeyOf(leaseId: string, level: ReminderLevel, oldestDueOn: string): string {
  return `reminder:${leaseId}:${level}:${oldestDueOn}`;
}

async function rows<T extends Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return [...(await tx.execute<T>(query))] as T[];
}

type TermRaw = {
  rent_term_id: string;
  lease_id: string;
  lease_version: number;
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
  person_id: string | null;
  display_name: string | null;
  contact_point_id: string | null;
  contact_value: string | null;
};

/**
 * LOY-04 read side. The SQL mirrors the worker's `arrears.detect` query; the
 * rules that qualify and grade live in `@lfsci/domain`, so the two callers
 * cannot drift on the part that matters.
 */
async function overdueTerms(tx: Tx, asOf: string): Promise<TermRaw[]> {
  return rows<TermRaw>(
    tx,
    sql`SELECT t.id AS rent_term_id, t.lease_id, l.version AS lease_version,
               l.reference AS lease_reference, l.status AS lease_status,
               COALESCE(v.currency, l.currency) AS currency, t.status AS term_status,
               to_char(t.period_start, 'YYYY-MM-DD') AS period_start,
               to_char(t.period_end, 'YYYY-MM-DD') AS period_end,
               to_char(t.due_on, 'YYYY-MM-DD') AS due_on,
               v.total_amount,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL), 0)::text
                 AS allocated,
               COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                          WHERE a.rent_term_id = t.id AND a.reversed_at IS NULL
                            AND a.confirmed_by_odoo = false), 0)::text AS pending_allocated,
               tenant.person_id, tenant.display_name,
               tenant.contact_point_id, tenant.contact_value
          FROM rent_term t
          JOIN lease l ON l.id = t.lease_id
          LEFT JOIN rent_term_version v ON v.id = t.current_version_id
          LEFT JOIN LATERAL (
                 SELECT p.id AS person_id, p.display_name,
                        c.id AS contact_point_id, c.value AS contact_value
                   FROM lease_party lp
                   JOIN person p ON p.id = lp.person_id
                   LEFT JOIN LATERAL (
                          SELECT cp.id, cp.value FROM contact_point cp
                           WHERE cp.person_id = p.id AND cp.kind = 'email'
                             AND cp.status = 'active'
                           ORDER BY cp.is_primary DESC, cp.created_at
                           LIMIT 1
                        ) c ON TRUE
                  WHERE lp.lease_id = l.id AND lp.role IN ('holder', 'co_holder')
                    AND (lp.ends_on IS NULL OR lp.ends_on >= ${asOf}::date)
                  ORDER BY lp.is_billing_contact DESC, lp.role, lp.starts_on
                  LIMIT 1
               ) tenant ON TRUE
         WHERE t.due_on < ${asOf}::date
           AND t.status NOT IN ('settled', 'cancelled')
         ORDER BY t.due_on, t.id
         LIMIT ${TERM_LIMIT}`,
  );
}

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
    sql`SELECT health,
               to_char(last_success_at AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS success_on
          FROM integration_cursor
         WHERE connector = ${LEDGER_CONNECTOR}
         ORDER BY last_success_at DESC NULLS LAST
         LIMIT 1`,
  );
  const row = found[0];
  if (!row) return { healthy: true, staleDays: null };
  return {
    healthy: row.health === "healthy" || row.health === "degraded",
    staleDays: row.success_on === null ? null : daysLate(row.success_on, asOf),
  };
}

type ReminderRaw = {
  message_id: string;
  lease_id: string;
  template_code: string | null;
  template_version: string | null;
  subject: string | null;
  recipient_address: string;
  status: string;
  error_code: string | null;
  provider_message_id: string | null;
  command_id: string | null;
  command_status: string | null;
  sent_at: string | null;
  created_at: string;
};

async function reminderHistory(tx: Tx): Promise<Map<string, ReminderHistoryEntry[]>> {
  const found = await rows<ReminderRaw>(
    tx,
    sql`SELECT m.id AS message_id, o.lease_id, m.template_code, m.template_version, m.subject,
               m.recipient_address, m.status, m.error_code, m.provider_message_id,
               c.id AS command_id, c.status AS command_status,
               m.first_attempt_at AS sent_at, m.created_at
          FROM message_outbound m
          JOIN object_ref o ON o.id = m.related_object_ref_id
          LEFT JOIN outbox_entry e ON e.message_outbound_id = m.id
          LEFT JOIN command c ON c.id = e.command_id
         WHERE o.lease_id IS NOT NULL AND m.channel = 'email'
         ORDER BY m.created_at DESC
         LIMIT 200`,
  );
  const out = new Map<string, ReminderHistoryEntry[]>();
  for (const row of found) {
    const entry: ReminderHistoryEntry = {
      messageId: row.message_id,
      level: row.template_code ? (levelByTemplateCode.get(row.template_code) ?? null) : null,
      templateCode: row.template_code,
      templateVersion: row.template_version,
      subject: row.subject,
      recipient: row.recipient_address,
      status: row.status,
      errorCode: row.error_code,
      providerMessageId: row.provider_message_id,
      commandId: row.command_id,
      commandStatus: row.command_status,
      sentAt: instant(row.sent_at),
      createdAt: instant(row.created_at) ?? new Date().toISOString(),
    };
    const bucket = out.get(row.lease_id);
    if (bucket) bucket.push(entry);
    else out.set(row.lease_id, [entry]);
  }
  return out;
}

async function readScreen(tx: Tx, asOf: string): Promise<RecouvrementScreen> {
  const policy = DEFAULT_REMINDER_POLICY;
  const base = {
    asOf,
    policy: {
      graceDays: policy.graceDays,
      firstReminderDays: policy.firstReminderDays,
      secondReminderDays: policy.secondReminderDays,
      formalNoticeDays: policy.formalNoticeDays,
      minimumSpacingDays: policy.minimumSpacingDays,
      minimumOutstanding: policy.minimumOutstanding,
    },
  };

  const terms = await overdueTerms(tx, asOf);
  if (terms.length === 0) {
    return RecouvrementScreen.parse({
      ...base,
      totals: { leases: 0, suspended: 0, outstanding: "0.00", currency: "EUR" },
      rows: [],
    });
  }

  const credits = await unappliedCreditByLease(tx);
  const ledger = await ledgerFreshness(tx, asOf);
  const history = await reminderHistory(tx);

  const byLease = new Map<string, ArrearsRow>();
  for (const raw of terms) {
    const outstanding = outstandingOf({
      total: amount(raw.total_amount),
      allocated: amount(raw.allocated),
    });
    if (Number(outstanding) <= 0) continue;

    const qualification = qualifyArrears({
      termStatus: raw.term_status,
      leaseStatus: raw.lease_status,
      pendingAllocated: amount(raw.pending_allocated),
      unappliedCredit: amount(credits.get(raw.lease_id)),
      ledgerStaleDays: ledger.staleDays,
      ledgerHealthy: ledger.healthy,
    });

    const term = {
      rentTermId: raw.rent_term_id,
      periodStart: raw.period_start,
      periodEnd: raw.period_end,
      dueOn: raw.due_on,
      total: amount(raw.total_amount),
      allocated: amount(raw.allocated),
      outstanding,
      qualification,
    };

    const existing = byLease.get(raw.lease_id);
    if (existing) {
      existing.terms.push(term);
      existing.outstanding = sumAmounts([existing.outstanding, outstanding]);
      if (term.dueOn < existing.oldestDueOn) existing.oldestDueOn = term.dueOn;
      if (QUALIFICATION_RANK[qualification] > QUALIFICATION_RANK[existing.qualification]) {
        existing.qualification = qualification;
      }
      continue;
    }

    const reminders = history.get(raw.lease_id) ?? [];
    const last = reminders.find(
      (entry) => entry.level !== null && (entry.status === "sent" || entry.status === "delivered"),
    );
    byLease.set(raw.lease_id, {
      leaseId: raw.lease_id,
      leaseVersion: raw.lease_version,
      leaseReference: raw.lease_reference,
      leaseStatus: raw.lease_status,
      tenantPersonId: raw.person_id,
      tenantName: raw.display_name,
      recipientContactPointId: raw.contact_point_id,
      recipientAddress: raw.contact_value,
      currency: raw.currency,
      outstanding,
      oldestDueOn: term.dueOn,
      daysLate: 0,
      qualification,
      suspended: false,
      lastLevel: last?.level ?? null,
      lastSentOn: last?.sentAt ? last.sentAt.slice(0, 10) : null,
      nextLevel: null,
      nextAutonomy: null,
      holdReason: null,
      terms: [term],
      reminders,
    });
  }

  const graded = [...byLease.values()]
    .map((row) => {
      const decision = gradeReminder({
        today: asOf,
        dueOn: row.oldestDueOn,
        outstanding: row.outstanding,
        qualification: row.qualification,
        lastLevel: row.lastLevel,
        lastSentOn: row.lastSentOn,
      });
      return {
        ...row,
        daysLate: decision.daysLate,
        suspended: row.qualification !== "due",
        nextLevel: decision.propose ? decision.level : null,
        nextAutonomy: decision.propose ? decision.autonomy : null,
        holdReason: decision.propose ? null : decision.reason,
      };
    })
    .sort((a, b) => a.oldestDueOn.localeCompare(b.oldestDueOn));

  return RecouvrementScreen.parse({
    ...base,
    totals: {
      leases: graded.length,
      suspended: graded.filter((row) => row.suspended).length,
      outstanding: sumAmounts(graded.map((row) => row.outstanding)),
      currency: graded[0]?.currency ?? "EUR",
    },
    rows: graded,
  });
}

/**
 * LOY-04 / MSG-01 / IA-05: the reminder is prepared, never sent. The command
 * stays `prepared`, its outbox entry is parked on the email channel, and only
 * an explicit approval releases it — a mise en demeure is level D.
 */
async function propose(
  tx: Tx,
  actor: Actor,
  input: ProposeReminderInput,
): Promise<ProposeReminderResult> {
  const asOf = input.asOf ?? today();
  const screen = await readScreen(tx, asOf);
  const row = screen.rows.find((candidate) => candidate.leaseId === input.leaseId);
  if (!row) ruleViolation("Ce bail ne présente aucun impayé à la date demandée.");
  if (row.suspended) {
    ruleViolation(
      "La relance est suspendue : le paiement ou le dossier doit d’abord être clarifié.",
      {
        qualification: row.qualification,
      },
    );
  }
  if (row.nextLevel === null) {
    ruleViolation("Aucune relance n’est due à ce stade.", { reason: row.holdReason });
  }
  if (row.nextLevel !== input.level) {
    ruleViolation("Le niveau de relance proposé n’est plus celui attendu ; rechargez l’écran.", {
      expected: row.nextLevel,
      submitted: input.level,
    });
  }
  // A paid, irreversible side effect needs its capability proven before anything
  // is written: no active e-mail contact means no reminder, and it is said so.
  if (!row.tenantPersonId || !row.recipientContactPointId || !row.recipientAddress) {
    ruleViolation("Aucune adresse e-mail active n’est enregistrée pour ce locataire.");
  }

  const level = input.level;
  const rendered = renderReminder(level, {
    tenantName: row.tenantName ?? row.leaseReference,
    landlordName: "La gérance",
    leaseReference: row.leaseReference,
    unitLabel: null,
    currency: row.currency,
    outstanding: row.outstanding,
    oldestDueOn: row.oldestDueOn,
    daysLate: row.daysLate,
    terms: row.terms.map((term) => ({
      periodStart: term.periodStart,
      periodEnd: term.periodEnd,
      dueOn: term.dueOn,
      outstanding: term.outstanding,
    })),
    contact: "Cet e-mail est envoyé depuis l’outil de gestion de la SCI.",
  });

  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "lease",
    id: row.leaseId,
  });
  const dedupKey = dedupKeyOf(row.leaseId, level, row.oldestDueOn);

  const inserted = await tx
    .insert(tables.messageOutbound)
    .values({
      organizationId: actor.organizationId,
      channel: "email",
      recipientPersonId: row.tenantPersonId,
      recipientContactPointId: row.recipientContactPointId,
      recipientAddress: row.recipientAddress,
      subject: rendered.subject,
      body: rendered.text,
      templateCode: rendered.templateCode,
      templateVersion: rendered.templateVersion,
      relatedObjectRefId: objectRefId,
      status: "draft",
      dedupKey,
    })
    .onConflictDoNothing()
    .returning({ id: tables.messageOutbound.id });
  const messageId =
    inserted[0]?.id ??
    (
      await tx
        .select({ id: tables.messageOutbound.id })
        .from(tables.messageOutbound)
        .where(eq(tables.messageOutbound.dedupKey, dedupKey))
        .limit(1)
    )[0]?.id;
  if (!messageId) ruleViolation("Le message n’a pas pu être enregistré.");

  const payload = {
    channel: "email" as const,
    recipientPersonId: row.tenantPersonId,
    recipientContactPointId: row.recipientContactPointId,
    templateCode: rendered.templateCode,
    templateVersion: rendered.templateVersion,
    subject: rendered.subject,
    body: rendered.text,
    relatedObject: { kind: "lease" as const, id: row.leaseId },
    dedupKey,
  };
  const decisionLevel = autonomyForReminder(level);
  const command = await createCommand(tx, {
    organizationId: actor.organizationId,
    commandType: "send_message",
    operationKey: operationKey(messageId),
    payload,
    payloadHash: hashPayload(payload),
    targetObjectRefId: objectRefId,
    actorUserId: actor.actorUserId,
    autonomyLevel: decisionLevel,
    status: "prepared",
  });

  const parked = await tx
    .select({ id: tables.outboxEntry.id })
    .from(tables.outboxEntry)
    .where(
      and(eq(tables.outboxEntry.commandId, command.id), eq(tables.outboxEntry.channel, "email")),
    )
    .limit(1);
  if (!parked[0]) {
    await enqueueOutbox(tx, {
      organizationId: actor.organizationId,
      kind: "email",
      commandId: command.id,
      messageOutboundId: messageId,
      partitionKey: command.operationKey,
      payload,
      payloadHash: command.payloadHash,
      availableAt: PARKED_UNTIL,
    });
  }

  await recordFact(tx, actor, {
    kind: "lease",
    id: row.leaseId,
    type: "arrears.reminder_proposed",
    payload: { level, messageId, outstanding: row.outstanding, currency: row.currency },
  });
  await audit(tx, actor, {
    objectTable: "message_outbound",
    objectId: messageId,
    objectRefId,
    action: "reminder.propose",
    after: {
      level,
      templateCode: rendered.templateCode,
      templateVersion: rendered.templateVersion,
    },
  });

  return {
    commandId: command.id,
    commandStatus: command.status,
    decisionLevel,
    messageId,
    level,
    templateCode: rendered.templateCode,
    templateVersion: rendered.templateVersion,
    subject: rendered.subject,
    body: rendered.text,
    screen: await readScreen(tx, asOf),
  };
}

export const recouvrementRouter = {
  recouvrement: {
    list: withOrganization.recouvrement.list
      .use(validated(RecouvrementScreen))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => readScreen(tx, input.asOf ?? today())),
      ),
    propose: withOrganization.recouvrement.propose.handler(({ context, input }) =>
      tenant(scope(context), (tx) => propose(tx, actorOf(context), input)),
    ),
  },
};
