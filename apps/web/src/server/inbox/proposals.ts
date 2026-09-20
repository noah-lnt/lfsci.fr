import "server-only";
import { decisionLevelByCommand } from "@lfsci/contracts";
import { createCommand, hashPayload, type Tx, tables } from "@lfsci/db";
import {
  type AllocationConfirmation,
  detectRuleProposals,
  MIN_CONFIRMATIONS,
  type RuleProposal,
} from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import { eq, sql } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import type {
  RuleProposalDecisionInput,
  RuleProposalDecisionResult,
  RuleProposalsResult,
} from "@/lib/contracts/inbox";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { audit } from "../finance/facts";
import { today } from "../finance/shared";

const OPERATION_NAMESPACE = "8b4d1f2a-5e6c-4f0b-9a17-3c2d5e8f7a61";
const RULE_DOMAIN = "expense_routing";
const RULE_ORIGIN = "proposed_by_pattern";

/** Two years of confirmations: older habits are not evidence of today's practice. */
const LOOKBACK_MONTHS = 24;
const CONFIRMATION_LIMIT = 2000;

type RawConfirmation = {
  id: string;
  origin_key: string;
  origin_label: string;
  target: string;
  target_id: string | null;
  target_label: string | null;
  category: string | null;
  recoverable: boolean;
  account_hint: string | null;
  confirmed_on: string;
  evidence_label: string | null;
};

/**
 * A confirmation is an allocation a human settled: `rule_version_id IS NULL` means no
 * rule produced it, so repeating it is the owner's own decision, not a rule's output.
 */
const CONFIRMATIONS = sql`
  SELECT al.id,
         s.id::text AS origin_key,
         s.name AS origin_label,
         al.target,
         COALESCE(al.unit_id, al.building_id, al.legal_entity_id)::text AS target_id,
         COALESCE(u.label, b.name, le.name) AS target_label,
         l.charge_nature AS category,
         (al.recoverable_amount > 0) AS recoverable,
         l.account_hint,
         to_char(COALESCE(e.issued_on, al.created_at::date), 'YYYY-MM-DD') AS confirmed_on,
         COALESCE(e.supplier_reference, l.description) AS evidence_label
    FROM expense_allocation al
    JOIN expense_line l ON l.id = al.expense_line_id
    JOIN expense e ON e.id = l.expense_id
    JOIN supplier s ON s.id = e.supplier_id
    LEFT JOIN unit u ON u.id = al.unit_id
    LEFT JOIN building b ON b.id = al.building_id
    LEFT JOIN legal_entity le ON le.id = al.legal_entity_id
   WHERE al.rule_version_id IS NULL
     AND e.status IN ('validated', 'posted', 'paid', 'reconciled')
     AND COALESCE(e.issued_on, al.created_at::date)
         >= (now() - ${`${LOOKBACK_MONTHS} months`}::interval)::date
   ORDER BY confirmed_on
   LIMIT ${CONFIRMATION_LIMIT}`;

function toConfirmation(raw: RawConfirmation): AllocationConfirmation {
  return {
    id: raw.id,
    origin: { kind: "supplier", key: raw.origin_key, label: raw.origin_label },
    effect: {
      target: raw.target as AllocationConfirmation["effect"]["target"],
      targetId: raw.target_id,
      targetLabel: raw.target_label ?? raw.target,
      category: raw.category,
      recoverable: raw.recoverable,
      accountHint: raw.account_hint,
    },
    confirmedOn: raw.confirmed_on,
    evidenceLabel: raw.evidence_label ?? raw.origin_label,
  };
}

async function readConfirmations(tx: Tx): Promise<AllocationConfirmation[]> {
  const rows = [...(await tx.execute<RawConfirmation>(CONFIRMATIONS))] as RawConfirmation[];
  return rows.map(toConfirmation);
}

/** A code already materialised as a rule has been answered: activated or dismissed. */
async function settledCodes(tx: Tx): Promise<Set<string>> {
  const rows = await tx
    .select({ code: tables.rule.code })
    .from(tables.rule)
    .where(eq(tables.rule.origin, RULE_ORIGIN));
  return new Set(rows.map((row) => row.code));
}

async function detect(tx: Tx): Promise<RuleProposal[]> {
  const [confirmations, settled] = await Promise.all([readConfirmations(tx), settledCodes(tx)]);
  return detectRuleProposals(confirmations).filter((proposal) => !settled.has(proposal.code));
}

async function counts(tx: Tx): Promise<{ awaitingApproval: number; dismissed: number }> {
  const rows = await tx
    .select({ status: tables.rule.status })
    .from(tables.rule)
    .where(eq(tables.rule.origin, RULE_ORIGIN));
  return {
    awaitingApproval: rows.filter((row) => row.status === "proposed").length,
    dismissed: rows.filter((row) => row.status === "retired").length,
  };
}

export async function listRuleProposals(scope: TenantScope): Promise<RuleProposalsResult> {
  return tenant(scope, async (tx) => {
    const [items, tallies] = await Promise.all([detect(tx), counts(tx)]);
    return {
      items: items.map((proposal) => ({
        code: proposal.code,
        originKind: proposal.origin.kind,
        originLabel: proposal.origin.label,
        target: proposal.effect.target,
        targetLabel: proposal.effect.targetLabel,
        category: proposal.effect.category,
        recoverable: proposal.effect.recoverable,
        accountHint: proposal.effect.accountHint,
        confirmationCount: proposal.confirmationCount,
        firstConfirmedOn: proposal.firstConfirmedOn,
        lastConfirmedOn: proposal.lastConfirmedOn,
        examples: proposal.examples,
      })),
      minConfirmations: MIN_CONFIRMATIONS,
      ...tallies,
    };
  });
}

function labelOf(proposal: RuleProposal): string {
  return `${proposal.origin.label} → ${proposal.effect.targetLabel}`;
}

function definitionOf(proposal: RuleProposal): Record<string, unknown> {
  return {
    match: { origin: proposal.origin.kind, key: proposal.origin.key },
    apply: {
      target: proposal.effect.target,
      targetId: proposal.effect.targetId,
      category: proposal.effect.category,
      recoverable: proposal.effect.recoverable,
      accountHint: proposal.effect.accountHint,
    },
  };
}

async function insertRule(
  tx: Tx,
  organizationId: string,
  proposal: RuleProposal,
  status: "proposed" | "retired",
  reason: string | null,
): Promise<string> {
  const inserted = await tx
    .insert(tables.rule)
    .values({
      organizationId,
      code: proposal.code,
      domain: RULE_DOMAIN,
      label: labelOf(proposal),
      origin: RULE_ORIGIN,
      status,
      suspendedReason: reason,
    })
    .onConflictDoNothing()
    .returning({ id: tables.rule.id });
  const id = inserted[0]?.id;
  if (id) return id;
  throw new AppError("CONFLICT", {
    message: "Cette proposition a déjà été traitée.",
    details: { code: proposal.code },
  });
}

/**
 * IA-06: the rule is written as `proposed` with a `draft` version and an
 * `activate_rule` command awaiting approval. Nothing here activates anything —
 * only the owner's approval of that command does.
 */
async function activate(
  tx: Tx,
  scope: TenantScope,
  proposal: RuleProposal,
): Promise<RuleProposalDecisionResult> {
  const organizationId = scope.organizationId;
  const actor = { organizationId, actorUserId: scope.session?.user.id ?? null };
  const ruleId = await insertRule(tx, organizationId, proposal, "proposed", null);

  const definition = definitionOf(proposal);
  const definitionHash = hashPayload(definition);
  const effectiveFrom = today();

  const versions = await tx
    .insert(tables.ruleVersion)
    .values({
      organizationId,
      ruleId,
      sequence: 1,
      definition,
      definitionHash,
      scope: { origin: proposal.origin, confirmationCount: proposal.confirmationCount },
      examples: proposal.examples,
      effectiveFrom,
      status: "draft",
    })
    .returning({ id: tables.ruleVersion.id });
  const ruleVersionId = versions[0]?.id;
  if (!ruleVersionId) throw new Error("rule_version insert returned no row");

  const payload = { ruleId, ruleVersionId, definitionHash, effectiveFrom };
  const command = await createCommand(tx, {
    organizationId,
    commandType: "activate_rule",
    operationKey: uuidv5(`activate_rule:${ruleVersionId}`, OPERATION_NAMESPACE),
    payload,
    payloadHash: hashPayload(payload),
    actorUserId: actor.actorUserId,
    autonomyLevel: decisionLevelByCommand.activate_rule,
    status: "prepared",
  });

  await audit(tx, actor, {
    objectTable: "rule",
    objectId: ruleId,
    action: "rule.proposal.submitted",
    after: { code: proposal.code, definition, confirmationCount: proposal.confirmationCount },
  });

  return { outcome: "awaiting_approval", code: proposal.code, commandId: command.id };
}

async function dismiss(
  tx: Tx,
  scope: TenantScope,
  proposal: RuleProposal,
  reason: string | null,
): Promise<RuleProposalDecisionResult> {
  const organizationId = scope.organizationId;
  const actor = { organizationId, actorUserId: scope.session?.user.id ?? null };
  const ruleId = await insertRule(tx, organizationId, proposal, "retired", reason);
  await audit(tx, actor, {
    objectTable: "rule",
    objectId: ruleId,
    action: "rule.proposal.dismissed",
    after: { code: proposal.code },
    ...(reason ? { reason } : {}),
  });
  return { outcome: "dismissed", code: proposal.code, commandId: null };
}

export async function decideRuleProposal(
  scope: TenantScope,
  input: RuleProposalDecisionInput,
): Promise<RuleProposalDecisionResult> {
  return tenant(scope, async (tx) => {
    // IA-02: the screen sends a code, never an effect — the proposal is recomputed
    // from the confirmations so no caller can have a rule written for them.
    const proposal = (await detect(tx)).find((candidate) => candidate.code === input.code);
    if (!proposal) {
      throw new AppError("NOT_FOUND", {
        message: "Cette proposition n’est plus d’actualité.",
        details: { code: input.code },
      });
    }
    return input.decision === "activate"
      ? activate(tx, scope, proposal)
      : dismiss(tx, scope, proposal, input.reason ?? null);
  });
}
