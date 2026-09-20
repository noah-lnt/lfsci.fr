import "server-only";
import { type Tx, tables } from "@lfsci/db";
import { type AccountMovement, bankBalanceAt } from "@lfsci/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AccountBalance,
  BankOverview,
  BankTransactionRow,
  CreateBankAccountInput,
  CreateInternalTransferInput,
  InternalTransferRow,
  UpdateBankAccountInput,
  UpdateInternalTransferInput,
} from "@/lib/contracts/finance";
import { type Actor, audit, recordFact } from "./facts";
import { mapBankAccount } from "./mappers";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  sumAmounts,
  today,
  versionConflict,
} from "./shared";

/**
 * BAN-01 / question 14: the accounting ledger is the authority for cash. The
 * back-sync writes Odoo's own balance into `bank_account.odoo_balance` with its
 * date; when that copy exists and is not later than the requested date, it is
 * the answer. Otherwise the balance is rebuilt from the opening balance and the
 * mirrored statement lines, and labelled by what fed it: ledger lines only,
 * or computed as soon as one line came from an import.
 */
function fromLedger(row: { odooStatementLineId: number | null }): boolean {
  return row.odooStatementLineId !== null;
}

async function accountsOf(tx: Tx, legalEntityId: string | undefined) {
  return tx
    .select()
    .from(tables.bankAccount)
    .where(legalEntityId ? eq(tables.bankAccount.legalEntityId, legalEntityId) : undefined)
    .orderBy(asc(tables.bankAccount.label));
}

export async function accountBalances(
  tx: Tx,
  legalEntityId: string | undefined,
  asOf: string,
): Promise<AccountBalance[]> {
  const accounts = await accountsOf(tx, legalEntityId);
  if (accounts.length === 0) return [];

  const movements = await tx
    .select({
      bankAccountId: tables.bankTransaction.bankAccountId,
      bookedOn: tables.bankTransaction.bookedOn,
      amount: tables.bankTransaction.amount,
      odooStatementLineId: tables.bankTransaction.odooStatementLineId,
      readAt: tables.bankTransaction.readAt,
    })
    .from(tables.bankTransaction)
    .where(
      inArray(
        tables.bankTransaction.bankAccountId,
        accounts.map((account) => account.id),
      ),
    );

  const byAccount = new Map<string, typeof movements>();
  for (const movement of movements) {
    const bucket = byAccount.get(movement.bankAccountId) ?? [];
    bucket.push(movement);
    byAccount.set(movement.bankAccountId, bucket);
  }

  return accounts.map((account) => {
    const rows = byAccount.get(account.id) ?? [];
    const lines: AccountMovement[] = rows.map((row) => ({
      bookedOn: row.bookedOn,
      amount: amount(row.amount),
      fromLedger: fromLedger(row),
    }));
    const lastRead = rows
      .map((row) => row.readAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1);
    return resolveAccountBalance(
      {
        id: account.id,
        label: account.label,
        currency: account.currency,
        openingBalance: amount(account.openingBalance),
        openingBalanceOn: account.openingBalanceOn,
        odooBalance: account.odooBalance === null ? null : amount(account.odooBalance),
        odooBalanceOn: account.odooBalanceOn,
        odooReadAt: account.odooReadAt,
        lastMovementReadAt: lastRead ?? null,
      },
      lines,
      asOf,
    );
  });
}

export type AccountBalanceSource = {
  id: string;
  label: string;
  currency: string;
  openingBalance: string;
  openingBalanceOn: string | null;
  odooBalance: string | null;
  odooBalanceOn: string | null;
  odooReadAt: string | null;
  lastMovementReadAt: string | null;
};

/** The ledger's dated balance wins; the reconstruction is the fallback, labelled. */
export function resolveAccountBalance(
  account: AccountBalanceSource,
  lines: readonly AccountMovement[],
  asOf: string,
): AccountBalance {
  const computed = bankBalanceAt({
    openingBalance: account.openingBalance,
    openingBalanceOn: account.openingBalanceOn,
    movements: lines,
    asOf,
  });
  const ledger =
    account.odooBalance !== null && account.odooBalanceOn !== null && account.odooBalanceOn <= asOf
      ? { balance: account.odooBalance, on: account.odooBalanceOn }
      : null;
  if (ledger) {
    return {
      bankAccountId: account.id,
      label: account.label,
      balance: ledger.balance,
      currency: account.currency,
      asOf: ledger.on,
      basis: "ledger",
      source: "odoo",
      readAt: account.odooReadAt ? new Date(account.odooReadAt).toISOString() : null,
      movements: computed.movements,
      ledgerMovements: computed.ledgerMovements,
      importedMovements: computed.importedMovements,
    };
  }
  return {
    bankAccountId: account.id,
    label: account.label,
    balance: computed.balance,
    currency: account.currency,
    asOf: computed.asOf,
    basis: computed.basis,
    source: computed.basis === "ledger" ? "odoo" : "saas_projection",
    readAt: account.lastMovementReadAt ? new Date(account.lastMovementReadAt).toISOString() : null,
    movements: computed.movements,
    ledgerMovements: computed.ledgerMovements,
    importedMovements: computed.importedMovements,
  };
}

/** The consolidated figure is only as good as its weakest account. */
export function consolidatedBasis(balances: readonly AccountBalance[]): AccountBalance["basis"] {
  if (balances.length === 0) return "opening_only";
  if (balances.some((balance) => balance.basis === "computed")) return "computed";
  if (balances.every((balance) => balance.basis === "opening_only")) return "opening_only";
  return balances.some((balance) => balance.basis === "ledger") ? "ledger" : "computed";
}

async function transfersOf(
  tx: Tx,
  legalEntityId: string | undefined,
): Promise<InternalTransferRow[]> {
  const source = tables.bankAccount;
  const rows = await tx
    .select({
      id: tables.internalTransfer.id,
      sourceBankAccountId: tables.internalTransfer.sourceBankAccountId,
      targetBankAccountId: tables.internalTransfer.targetBankAccountId,
      amount: tables.internalTransfer.amount,
      currency: tables.internalTransfer.currency,
      initiatedOn: tables.internalTransfer.initiatedOn,
      settledOn: tables.internalTransfer.settledOn,
      status: tables.internalTransfer.status,
      version: tables.internalTransfer.version,
    })
    .from(tables.internalTransfer)
    .where(legalEntityId ? eq(tables.internalTransfer.legalEntityId, legalEntityId) : undefined)
    .orderBy(desc(tables.internalTransfer.initiatedOn));
  if (rows.length === 0) return [];

  const labels = await tx.select({ id: source.id, label: source.label }).from(source);
  const labelById = new Map(labels.map((row) => [row.id, row.label]));
  return rows.map((row) => ({
    ...row,
    amount: amount(row.amount),
    sourceLabel: labelById.get(row.sourceBankAccountId) ?? "—",
    targetLabel: labelById.get(row.targetBankAccountId) ?? "—",
  }));
}

export async function bankOverview(
  tx: Tx,
  input: { legalEntityId?: string | undefined },
): Promise<BankOverview> {
  const asOf = today();
  const [accounts, balances, transfers] = await Promise.all([
    accountsOf(tx, input.legalEntityId),
    accountBalances(tx, input.legalEntityId, asOf),
    transfersOf(tx, input.legalEntityId),
  ]);
  const unreconciled =
    accounts.length === 0
      ? [{ count: 0 }]
      : await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tables.bankTransaction)
          .where(
            and(
              inArray(
                tables.bankTransaction.bankAccountId,
                accounts.map((account) => account.id),
              ),
              eq(tables.bankTransaction.reconciliationStatus, "unreconciled"),
            ),
          );

  return {
    asOf,
    currency: accounts[0]?.currency ?? "EUR",
    accounts: accounts.map(mapBankAccount),
    balances,
    total: sumAmounts(balances.map((balance) => balance.balance)),
    totalBasis: consolidatedBasis(balances),
    transfers,
    unreconciled: unreconciled[0]?.count ?? 0,
  };
}

export async function listTransactions(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    bankAccountId?: string | undefined;
    reconciliationStatus?: string | undefined;
  },
): Promise<{ items: BankTransactionRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.bankAccountId ? eq(tables.bankTransaction.bankAccountId, input.bankAccountId) : undefined,
    input.reconciliationStatus
      ? eq(tables.bankTransaction.reconciliationStatus, input.reconciliationStatus)
      : undefined,
  ].filter((clause) => clause !== undefined);
  const rows = await tx
    .select()
    .from(tables.bankTransaction)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.bankTransaction.bookedOn))
    .limit(limit + 1)
    .offset(offset);

  return {
    items: rows.slice(0, limit).map((row) => ({
      id: row.id,
      bankAccountId: row.bankAccountId,
      bookedOn: row.bookedOn,
      valueOn: row.valueOn,
      amount: amount(row.amount),
      currency: row.currency,
      label: row.label,
      counterpartyName: row.counterpartyName,
      reconciliationStatus: row.reconciliationStatus,
      fromLedger: fromLedger(row),
      readAt: row.readAt ? new Date(row.readAt).toISOString() : null,
    })),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function createAccount(tx: Tx, actor: Actor, input: CreateBankAccountInput) {
  const inserted = await tx
    .insert(tables.bankAccount)
    .values({
      organizationId: actor.organizationId,
      legalEntityId: input.legalEntityId,
      label: input.label,
      bankName: input.bankName ?? null,
      ibanLast4: input.ibanLast4 ?? null,
      purpose: input.purpose ?? "operating",
      openingBalance: input.openingBalance ?? "0.00",
      openingBalanceOn: input.openingBalanceOn ?? null,
      feedSource: input.feedSource ?? null,
    })
    .returning();
  const account = firstOr(inserted, "Compte bancaire");
  await audit(tx, actor, {
    objectTable: "bank_account",
    objectId: account.id,
    action: "create",
    after: { label: account.label, openingBalance: account.openingBalance },
  });
  return mapBankAccount(account);
}

export async function updateAccount(tx: Tx, actor: Actor, input: UpdateBankAccountInput) {
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.bankName === undefined ? {} : { bankName: input.bankName }),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    ...(input.openingBalance === undefined ? {} : { openingBalance: input.openingBalance }),
    ...(input.openingBalanceOn === undefined ? {} : { openingBalanceOn: input.openingBalanceOn }),
    ...(input.feedSource === undefined ? {} : { feedSource: input.feedSource }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  const updated = await tx
    .update(tables.bankAccount)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.bankAccount.id, input.id),
        eq(tables.bankAccount.version, input.expectedVersion),
      ),
    )
    .returning();
  const account = updated[0];
  if (!account) versionConflict("Le compte bancaire");
  await audit(tx, actor, {
    objectTable: "bank_account",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return mapBankAccount(account);
}

/** F09: an internal transfer moves cash between our own accounts, it is never income. */
export async function createTransfer(
  tx: Tx,
  actor: Actor,
  input: CreateInternalTransferInput,
): Promise<InternalTransferRow> {
  if (input.sourceBankAccountId === input.targetBankAccountId) {
    ruleViolation("Un virement interne relie deux comptes différents.");
  }
  const inserted = await tx
    .insert(tables.internalTransfer)
    .values({
      organizationId: actor.organizationId,
      legalEntityId: input.legalEntityId,
      sourceBankAccountId: input.sourceBankAccountId,
      targetBankAccountId: input.targetBankAccountId,
      amount: input.amount,
      initiatedOn: input.initiatedOn,
      status: "in_transit",
    })
    .returning();
  const transfer = firstOr(inserted, "Virement interne");
  await recordFact(tx, actor, {
    kind: "bank_account",
    id: transfer.sourceBankAccountId,
    type: "bank.transfer_initiated",
    payload: { transferId: transfer.id, amount: amount(transfer.amount) },
  });
  await audit(tx, actor, {
    objectTable: "internal_transfer",
    objectId: transfer.id,
    action: "create",
    after: { amount: amount(transfer.amount), status: transfer.status },
  });
  return readTransfer(tx, transfer.id);
}

export async function updateTransfer(
  tx: Tx,
  actor: Actor,
  input: UpdateInternalTransferInput,
): Promise<InternalTransferRow> {
  const updated = await tx
    .update(tables.internalTransfer)
    .set({
      status: input.status,
      ...(input.settledOn === undefined ? {} : { settledOn: input.settledOn }),
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tables.internalTransfer.id, input.id),
        eq(tables.internalTransfer.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated[0]) versionConflict("Le virement interne");
  await audit(tx, actor, {
    objectTable: "internal_transfer",
    objectId: input.id,
    action: "update",
    after: { status: input.status, settledOn: input.settledOn ?? null },
  });
  return readTransfer(tx, input.id);
}

async function readTransfer(tx: Tx, id: string): Promise<InternalTransferRow> {
  const row = firstOr(
    await tx
      .select()
      .from(tables.internalTransfer)
      .where(eq(tables.internalTransfer.id, id))
      .limit(1),
    "Virement interne",
  );
  const labels = await tx
    .select({ id: tables.bankAccount.id, label: tables.bankAccount.label })
    .from(tables.bankAccount)
    .where(inArray(tables.bankAccount.id, [row.sourceBankAccountId, row.targetBankAccountId]));
  const labelById = new Map(labels.map((entry) => [entry.id, entry.label]));
  return {
    id: row.id,
    sourceBankAccountId: row.sourceBankAccountId,
    targetBankAccountId: row.targetBankAccountId,
    sourceLabel: labelById.get(row.sourceBankAccountId) ?? "—",
    targetLabel: labelById.get(row.targetBankAccountId) ?? "—",
    amount: amount(row.amount),
    currency: row.currency,
    initiatedOn: row.initiatedOn,
    settledOn: row.settledOn,
    status: row.status,
    version: row.version,
  };
}
