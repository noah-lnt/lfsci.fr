import "server-only";
import { decisionLevelByCommand } from "@lfsci/contracts";
import { createCommand, ensureObjectRef, hashPayload, type Tx, tables } from "@lfsci/db";
import { buildCcaLedger, type CcaMovementKind as DomainKind } from "@lfsci/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import type { CcaLedger, RecordCcaMovementResult } from "@/lib/contracts/finance";
import { type Actor, audit, recordFact } from "./facts";
import { mapCcaMovement, mapCurrentAccount } from "./mappers";
import { amount, DEFAULT_LIMIT, firstOr, nextCursor, offsetFromCursor } from "./shared";

type MovementRow = typeof tables.ccaMovement.$inferSelect;

/**
 * CCA-02: `offset` settles the debt like a repayment; `correction` carries its
 * own sign. Neither may recreate the expense the original movement booked.
 */
const domainKind: Record<string, DomainKind> = {
  contribution: "contribution",
  expense_paid_personally: "personal_expense",
  repayment: "reimbursement",
  interest: "interest",
  offset: "reimbursement",
  correction: "contribution",
};

function ledgerOf(rows: readonly MovementRow[]) {
  return buildCcaLedger(
    rows
      .filter((row) => row.status !== "rejected")
      .map((row) => ({
        id: row.id,
        date: row.occurredOn,
        kind: domainKind[row.kind] ?? "contribution",
        amount: amount(row.amount),
      })),
  );
}

export async function listCurrentAccounts(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    legalEntityId?: string | undefined;
  },
) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const rows = await tx
    .select()
    .from(tables.partnerCurrentAccount)
    .where(
      input.legalEntityId
        ? eq(tables.partnerCurrentAccount.legalEntityId, input.legalEntityId)
        : undefined,
    )
    .orderBy(asc(tables.partnerCurrentAccount.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  const items = [];
  for (const row of page) {
    const movements = await tx
      .select()
      .from(tables.ccaMovement)
      .where(eq(tables.ccaMovement.ccaId, row.id));
    items.push(mapCurrentAccount(row, ledgerOf(movements).balance));
  }
  return { items, nextCursor: nextCursor(offset, limit, rows.length) };
}

/** CCA-01: our running balance is a projection; Odoo's, when read, is the official one. */
export async function getCurrentAccount(tx: Tx, id: string): Promise<CcaLedger> {
  const account = firstOr(
    await tx
      .select()
      .from(tables.partnerCurrentAccount)
      .where(eq(tables.partnerCurrentAccount.id, id))
      .limit(1),
    "Compte courant d’associé",
  );
  const movements = await tx
    .select()
    .from(tables.ccaMovement)
    .where(eq(tables.ccaMovement.ccaId, id))
    .orderBy(asc(tables.ccaMovement.occurredOn));
  const persons = await tx
    .select({ displayName: tables.person.displayName })
    .from(tables.person)
    .where(eq(tables.person.id, account.partnerPersonId))
    .limit(1);

  const ledger = ledgerOf(movements);
  const statusById = new Map(movements.map((row) => [row.id, row.status]));
  const kindById = new Map(movements.map((row) => [row.id, row.kind]));

  return {
    account: mapCurrentAccount(account, ledger.balance),
    partnerName: persons[0]?.displayName ?? "Associé",
    entries: ledger.entries.map((entry) => ({
      id: entry.id,
      occurredOn: entry.date,
      kind: kindById.get(entry.id) ?? entry.kind,
      amount: entry.amount,
      balance: entry.balance,
      expense: entry.expense,
      status: statusById.get(entry.id) ?? "proposed",
    })),
    balance: ledger.balance,
    totalExpense: ledger.totalExpense,
    direction: ledger.direction,
    odooBalance: mapCurrentAccount(account, ledger.balance).odooBalance,
    odooReadAt: mapCurrentAccount(account, ledger.balance).odooReadAt,
  };
}

export async function listMovements(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    ccaId?: string | undefined;
    status?: string | undefined;
  },
) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.ccaId ? eq(tables.ccaMovement.ccaId, input.ccaId) : undefined,
    input.status ? eq(tables.ccaMovement.status, input.status) : undefined,
  ].filter((clause) => clause !== undefined);
  const rows = await tx
    .select()
    .from(tables.ccaMovement)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.ccaMovement.occurredOn))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(mapCcaMovement),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

/**
 * CCA-02 / WF-01: the movement is written `proposed` and the accounting command
 * is prepared at decision level D. Nothing reaches Odoo before a validation.
 */
export async function recordMovement(
  tx: Tx,
  actor: Actor,
  input: {
    ccaId: string;
    kind: string;
    amount: string;
    occurredOn: string;
    expenseId?: string | undefined;
    paymentId?: string | undefined;
    justification: string;
  },
): Promise<RecordCcaMovementResult> {
  const account = firstOr(
    await tx
      .select()
      .from(tables.partnerCurrentAccount)
      .where(eq(tables.partnerCurrentAccount.id, input.ccaId))
      .limit(1),
    "Compte courant d’associé",
  );

  const movement = firstOr(
    await tx
      .insert(tables.ccaMovement)
      .values({
        organizationId: actor.organizationId,
        ccaId: account.id,
        kind: input.kind,
        amount: input.amount,
        currency: account.currency,
        occurredOn: input.occurredOn,
        expenseId: input.expenseId ?? null,
        paymentId: input.paymentId ?? null,
        status: "proposed",
      })
      .returning(),
    "Mouvement de compte courant",
  );

  const payload = {
    ccaId: account.id,
    ccaMovementId: movement.id,
    kind: input.kind,
    amount: amount(movement.amount),
    currency: account.currency,
    occurredOn: movement.occurredOn,
    expenseId: movement.expenseId,
    justification: input.justification,
  };

  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "partner_current_account",
    id: account.id,
  });

  const decisionLevel = decisionLevelByCommand.record_cca_movement;
  const command = await createCommand(tx, {
    organizationId: actor.organizationId,
    commandType: "record_cca_movement",
    operationKey: `record_cca_movement:${movement.id}`,
    payload,
    payloadHash: hashPayload(payload),
    targetObjectRefId: objectRefId,
    actorUserId: actor.actorUserId,
    autonomyLevel: decisionLevel,
    status: "prepared",
  });

  await recordFact(tx, actor, {
    kind: "partner_current_account",
    id: account.id,
    type: "cca.movement_recorded",
    payload: { movementId: movement.id, commandId: command.id, amount: amount(movement.amount) },
  });
  await audit(tx, actor, {
    objectTable: "cca_movement",
    objectId: movement.id,
    objectRefId,
    action: "record",
    after: { kind: input.kind, amount: amount(movement.amount), status: movement.status },
    reason: input.justification,
  });

  return {
    movement: mapCcaMovement(movement),
    commandId: command.id,
    commandStatus: command.status,
    decisionLevel,
  };
}
