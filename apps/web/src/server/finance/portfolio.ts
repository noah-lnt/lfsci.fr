import "server-only";
import type { api } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { and, asc, eq, gte, inArray, lte, ne, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type {
  BankAccountSummary,
  FinanceDashboard,
  FinanceKpi,
  FixedAssetPosition,
} from "@/lib/contracts/finance";
import { aggregateForecast, type ForecastEvent } from "./forecast";
import { mapBankAccount, mapFixedAssetPosition } from "./mappers";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  sumAmounts,
  today,
} from "./shared";

type Forecast = z.infer<typeof api.finance.getCashForecast.output>;

const OPEN_EXPENSE_STATES = ["captured", "extracted", "to_review", "validated", "posted"];

export async function listAssets(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    legalEntityId?: string | undefined;
    status?: string | undefined;
  },
) {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const on = today();
  const filters = [
    input.legalEntityId ? eq(tables.fixedAsset.legalEntityId, input.legalEntityId) : undefined,
    input.status ? eq(tables.fixedAsset.status, input.status) : undefined,
  ].filter((clause) => clause !== undefined);
  const rows = await tx
    .select()
    .from(tables.fixedAsset)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tables.fixedAsset.label))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map((row) => mapFixedAssetPosition(row, on)),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getAsset(tx: Tx, id: string): Promise<FixedAssetPosition> {
  const rows = await tx
    .select()
    .from(tables.fixedAsset)
    .where(eq(tables.fixedAsset.id, id))
    .limit(1);
  return mapFixedAssetPosition(firstOr(rows, "Immobilisation"), today());
}

export async function listBankAccounts(
  tx: Tx,
  input: { legalEntityId?: string | undefined },
): Promise<{ accounts: BankAccountSummary[] }> {
  const rows = await tx
    .select()
    .from(tables.bankAccount)
    .where(
      input.legalEntityId ? eq(tables.bankAccount.legalEntityId, input.legalEntityId) : undefined,
    )
    .orderBy(asc(tables.bankAccount.label));
  return { accounts: rows.map(mapBankAccount) };
}

type AccountBalance = {
  bankAccountId: string;
  label: string;
  balance: string;
  currency: string;
  asOf: string;
  source: "odoo" | "saas_projection";
  readAt: string | null;
};

/** BAN-01: opening balance plus the mirrored movements, dated, never assumed complete. */
async function balancesOf(tx: Tx, legalEntityId: string | undefined): Promise<AccountBalance[]> {
  const accounts = await tx
    .select()
    .from(tables.bankAccount)
    .where(legalEntityId ? eq(tables.bankAccount.legalEntityId, legalEntityId) : undefined)
    .orderBy(asc(tables.bankAccount.label));
  if (accounts.length === 0) return [];

  const movements = await tx
    .select({
      bankAccountId: tables.bankTransaction.bankAccountId,
      total: sql<string>`coalesce(sum(${tables.bankTransaction.amount}), 0)`,
      lastBookedOn: sql<string | null>`max(${tables.bankTransaction.bookedOn})`,
      lastReadAt: sql<string | null>`max(${tables.bankTransaction.readAt})`,
    })
    .from(tables.bankTransaction)
    .where(
      inArray(
        tables.bankTransaction.bankAccountId,
        accounts.map((account) => account.id),
      ),
    )
    .groupBy(tables.bankTransaction.bankAccountId);
  const byAccount = new Map(movements.map((row) => [row.bankAccountId, row]));

  return accounts.map((account) => {
    const movement = byAccount.get(account.id);
    return {
      bankAccountId: account.id,
      label: account.label,
      balance: sumAmounts([account.openingBalance, movement?.total ?? "0"]),
      currency: account.currency,
      asOf: movement?.lastBookedOn ?? account.openingBalanceOn ?? today(),
      source: "saas_projection" as const,
      readAt: movement?.lastReadAt ? new Date(movement.lastReadAt).toISOString() : null,
    };
  });
}

export async function getBankBalances(
  tx: Tx,
  input: { legalEntityId?: string | undefined },
): Promise<z.infer<typeof api.finance.getBankBalances.output>> {
  return { balances: await balancesOf(tx, input.legalEntityId) };
}

async function forecastEvents(
  tx: Tx,
  legalEntityId: string | undefined,
  asOf: string,
  until: string,
): Promise<{ events: ForecastEvent[]; missingSources: string[] }> {
  const missingSources: string[] = [];
  const events: ForecastEvent[] = [];

  const terms = await tx
    .select({
      dueOn: tables.rentTerm.dueOn,
      totalAmount: tables.rentTermVersion.totalAmount,
    })
    .from(tables.rentTerm)
    .innerJoin(
      tables.rentTermVersion,
      eq(tables.rentTerm.currentVersionId, tables.rentTermVersion.id),
    )
    .where(
      and(
        gte(tables.rentTerm.dueOn, asOf),
        lte(tables.rentTerm.dueOn, until),
        notInArray(tables.rentTerm.status, ["settled", "cancelled"]),
      ),
    );
  for (const term of terms) {
    events.push({ on: term.dueOn, amount: amount(term.totalAmount), source: "rent_term" });
  }
  if (terms.length === 0) missingSources.push("termes de loyer");

  const installments = await tx
    .select({
      dueOn: tables.loanInstallment.dueOn,
      totalAmount: tables.loanInstallment.totalAmount,
    })
    .from(tables.loanInstallment)
    .innerJoin(
      tables.loanScheduleVersion,
      eq(tables.loanInstallment.scheduleVersionId, tables.loanScheduleVersion.id),
    )
    .innerJoin(tables.loan, eq(tables.loanScheduleVersion.loanId, tables.loan.id))
    .where(
      and(
        eq(tables.loanScheduleVersion.status, "active"),
        ne(tables.loanInstallment.status, "cancelled"),
        gte(tables.loanInstallment.dueOn, asOf),
        lte(tables.loanInstallment.dueOn, until),
        legalEntityId ? eq(tables.loan.legalEntityId, legalEntityId) : undefined,
      ),
    );
  for (const installment of installments) {
    events.push({
      on: installment.dueOn,
      amount: `-${amount(installment.totalAmount)}`,
      source: "loan_installment",
    });
  }

  const expenses = await tx
    .select({ issuedOn: tables.expense.issuedOn, totalInclTax: tables.expense.totalInclTax })
    .from(tables.expense)
    .where(
      and(
        inArray(tables.expense.status, OPEN_EXPENSE_STATES),
        legalEntityId ? eq(tables.expense.legalEntityId, legalEntityId) : undefined,
      ),
    );
  for (const expense of expenses) {
    // An expense carries no due date: an unsettled one weighs from today.
    const on = expense.issuedOn && expense.issuedOn > asOf ? expense.issuedOn : asOf;
    if (on > until) continue;
    events.push({ on, amount: `-${amount(expense.totalInclTax)}`, source: "expense" });
  }

  return { events, missingSources };
}

export async function getForecast(
  tx: Tx,
  input: { legalEntityId?: string | undefined; horizonDays: Forecast["horizonDays"] },
): Promise<Forecast> {
  const asOf = today();
  const balances = await balancesOf(tx, input.legalEntityId);
  const until = addDays(asOf, Number(input.horizonDays));
  const { events, missingSources } = await forecastEvents(tx, input.legalEntityId, asOf, until);
  if (balances.length === 0) missingSources.push("comptes bancaires");

  return aggregateForecast({
    asOf,
    horizonDays: input.horizonDays,
    currency: balances[0]?.currency ?? "EUR",
    openingBalance: sumAmounts(balances.map((balance) => balance.balance)),
    events,
    missingSources,
  });
}

function kpi(
  value: string | null,
  options: { asOf?: string | null; source?: FinanceKpi["source"]; detail?: string | null } = {},
): FinanceKpi {
  return {
    amount: value,
    currency: "EUR",
    asOf: options.asOf ?? null,
    source: options.source ?? "saas_projection",
    detail: options.detail ?? null,
  };
}

/** FIN-01: six figures, each with its source and its read date. */
export async function getDashboard(
  tx: Tx,
  input: { legalEntityId?: string | undefined },
): Promise<FinanceDashboard> {
  const asOf = today();
  const balances = await balancesOf(tx, input.legalEntityId);
  const forecast = await getForecast(tx, { ...input, horizonDays: "30" });

  const loans = await tx
    .select()
    .from(tables.loan)
    .where(
      and(
        inArray(tables.loan.status, ["active", "renegotiated"]),
        input.legalEntityId ? eq(tables.loan.legalEntityId, input.legalEntityId) : undefined,
      ),
    );
  const outstanding: string[] = [];
  let debtFromOdoo = loans.length > 0;
  for (const loan of loans) {
    if (loan.odooOutstandingPrincipal !== null) {
      outstanding.push(amount(loan.odooOutstandingPrincipal));
      continue;
    }
    debtFromOdoo = false;
    const past = await tx
      .select({ remainingPrincipal: tables.loanInstallment.remainingPrincipal })
      .from(tables.loanInstallment)
      .innerJoin(
        tables.loanScheduleVersion,
        eq(tables.loanInstallment.scheduleVersionId, tables.loanScheduleVersion.id),
      )
      .where(
        and(
          eq(tables.loanScheduleVersion.loanId, loan.id),
          eq(tables.loanScheduleVersion.status, "active"),
          lte(tables.loanInstallment.dueOn, asOf),
        ),
      )
      .orderBy(sql`${tables.loanInstallment.dueOn} DESC`)
      .limit(1);
    outstanding.push(amount(past[0]?.remainingPrincipal, amount(loan.principalAmount)));
  }

  const accounts = await tx
    .select({ id: tables.partnerCurrentAccount.id })
    .from(tables.partnerCurrentAccount)
    .where(
      input.legalEntityId
        ? eq(tables.partnerCurrentAccount.legalEntityId, input.legalEntityId)
        : undefined,
    );
  const ccaTotals =
    accounts.length === 0
      ? []
      : await tx
          .select({
            total: sql<string>`coalesce(sum(
            CASE WHEN ${tables.ccaMovement.kind} IN ('repayment','offset')
                 THEN -${tables.ccaMovement.amount} ELSE ${tables.ccaMovement.amount} END), 0)`,
          })
          .from(tables.ccaMovement)
          .where(
            and(
              inArray(
                tables.ccaMovement.ccaId,
                accounts.map((account) => account.id),
              ),
              ne(tables.ccaMovement.status, "rejected"),
            ),
          );

  const assets = await tx
    .select()
    .from(tables.fixedAsset)
    .where(
      and(
        notInArray(tables.fixedAsset.status, ["disposed", "cancelled"]),
        input.legalEntityId ? eq(tables.fixedAsset.legalEntityId, input.legalEntityId) : undefined,
      ),
    );

  const next = await tx
    .select({
      dueOn: tables.loanInstallment.dueOn,
      totalAmount: tables.loanInstallment.totalAmount,
      lenderName: tables.loan.lenderName,
      reference: tables.loan.reference,
    })
    .from(tables.loanInstallment)
    .innerJoin(
      tables.loanScheduleVersion,
      eq(tables.loanInstallment.scheduleVersionId, tables.loanScheduleVersion.id),
    )
    .innerJoin(tables.loan, eq(tables.loanScheduleVersion.loanId, tables.loan.id))
    .where(
      and(
        eq(tables.loanScheduleVersion.status, "active"),
        gte(tables.loanInstallment.dueOn, asOf),
        ne(tables.loanInstallment.status, "cancelled"),
        input.legalEntityId ? eq(tables.loan.legalEntityId, input.legalEntityId) : undefined,
      ),
    )
    .orderBy(asc(tables.loanInstallment.dueOn))
    .limit(1);

  const residual = await tx
    .select({ total: sql<string>`coalesce(sum(${tables.expenseLine.unallocatedAmount}), 0)` })
    .from(tables.expenseLine)
    .innerJoin(tables.expense, eq(tables.expenseLine.expenseId, tables.expense.id))
    .where(notInArray(tables.expense.status, ["cancelled", "rejected"]));

  const nextRow = next[0];
  return {
    asOf,
    currency: balances[0]?.currency ?? "EUR",
    banks: kpi(sumAmounts(balances.map((balance) => balance.balance)), {
      asOf:
        balances
          .map((balance) => balance.asOf)
          .sort()
          .at(-1) ?? null,
      detail: `${balances.length} compte${balances.length > 1 ? "s" : ""}`,
    }),
    treasury: kpi(forecast.closingBalance, { asOf, detail: "prévision à 30 jours" }),
    debt: kpi(sumAmounts(outstanding), {
      asOf,
      source: debtFromOdoo ? "odoo" : "saas_projection",
      detail: debtFromOdoo ? "capital restant dû comptable" : "capital restant dû prévisionnel",
    }),
    cca: kpi(amount(ccaTotals[0]?.total), { asOf, detail: "dette envers les associés" }),
    netBookValue: kpi(
      sumAmounts(assets.map((asset) => mapFixedAssetPosition(asset, asOf).netBookValueAt)),
      { asOf, detail: `${assets.length} actif${assets.length > 1 ? "s" : ""}` },
    ),
    nextInstallment: nextRow
      ? {
          dueOn: nextRow.dueOn,
          amount: amount(nextRow.totalAmount),
          label: `${nextRow.lenderName} · ${nextRow.reference}`,
          kind: "loan_installment",
        }
      : null,
    unallocatedExpenses: amount(residual[0]?.total),
  };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
