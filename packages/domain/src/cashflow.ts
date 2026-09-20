import { Decimal } from "decimal.js";
import { buildSchedule } from "./loans";
import { decimal, money, roundCent, sum, toMoney, ZERO } from "./money";
import { type Blocked, blocked } from "./result";

export type PeriodFacts = {
  openingBank: string;
  incomeAccrued: string;
  incomeCollected: string;
  operatingExpenses: string;
  operatingExpensesPaid: string;
  interestAccrued: string;
  interestPaid: string;
  depreciation: string;
  investmentPaid: string;
  principalRepaid: string;
  newLoanReceived: string;
  partnerAccountContribution: string;
};

export type BridgeLine = { label: string; amount: string };

export type CashBridge = {
  result: string;
  netBankFlow: string;
  closingBank: string;
  bridge: BridgeLine[];
  bridgeTotal: string;
  balanced: boolean;
};

// FIN-01 / F08 : apports et emprunts sont des flux, jamais des produits.
export function resultToCash(facts: PeriodFacts): CashBridge {
  const incomeAccrued = money(facts.incomeAccrued);
  const incomeCollected = money(facts.incomeCollected);
  const opex = money(facts.operatingExpenses);
  const opexPaid = money(facts.operatingExpensesPaid);
  const interest = money(facts.interestAccrued);
  const interestPaid = money(facts.interestPaid);
  const depreciation = money(facts.depreciation);
  const investment = money(facts.investmentPaid);
  const principal = money(facts.principalRepaid);
  const newLoan = money(facts.newLoanReceived);
  const cca = money(facts.partnerAccountContribution);
  const opening = money(facts.openingBank);

  const result = incomeAccrued.minus(opex).minus(interest).minus(depreciation);
  const netBankFlow = incomeCollected
    .minus(opexPaid)
    .minus(interestPaid)
    .minus(investment)
    .minus(principal)
    .plus(newLoan)
    .plus(cca);

  const receivables = incomeAccrued.minus(incomeCollected);
  const payables = opex.minus(opexPaid).plus(interest.minus(interestPaid));

  const bridge: BridgeLine[] = [
    { label: "result", amount: toMoney(result) },
    { label: "depreciation", amount: toMoney(depreciation) },
    { label: "receivables_change", amount: toMoney(receivables.negated()) },
    { label: "payables_change", amount: toMoney(payables) },
    { label: "investment", amount: toMoney(investment.negated()) },
    { label: "principal_repaid", amount: toMoney(principal.negated()) },
    { label: "new_loan", amount: toMoney(newLoan) },
    { label: "partner_account", amount: toMoney(cca) },
  ];
  const bridgeTotal = sum(bridge.map((l) => money(l.amount)));

  return {
    result: toMoney(result),
    netBankFlow: toMoney(netBankFlow),
    closingBank: toMoney(opening.plus(netBankFlow)),
    bridge,
    bridgeTotal: toMoney(bridgeTotal),
    balanced: bridgeTotal.equals(netBankFlow),
  };
}

export type TransferResult =
  | {
      ok: true;
      status: "settled" | "in_transit";
      balances: { accountId: string; balance: string }[];
      inTransit: string;
      consolidatedBefore: string;
      consolidatedAfter: string;
      variation: string;
      expense: string;
      income: string;
    }
  | Blocked<"unknown_account" | "same_account">;

// F09 : un virement interne ne crée ni produit ni charge ; seuls les frais
// bougent le consolidé. Pendant le transit, la contrepartie est attendue,
// jamais une anomalie définitive.
export function applyInternalTransfer(input: {
  accounts: readonly { accountId: string; balance: string }[];
  from: string;
  to: string;
  amount: string;
  fees?: string | undefined;
  creditReceived?: boolean | undefined;
}): TransferResult {
  if (input.from === input.to) return blocked("same_account", [input.from]);
  const balances = new Map(input.accounts.map((a) => [a.accountId, money(a.balance)]));
  const missing = [input.from, input.to].filter((id) => !balances.has(id));
  if (missing.length > 0) return blocked("unknown_account", missing);

  const amount = money(input.amount);
  const fees = money(input.fees ?? "0.00");
  const credited = input.creditReceived ?? true;
  const consolidatedBefore = sum([...balances.values()]);

  const fromBalance = balances.get(input.from) ?? ZERO;
  balances.set(input.from, fromBalance.minus(amount).minus(fees));
  if (credited) {
    const toBalance = balances.get(input.to) ?? ZERO;
    balances.set(input.to, toBalance.plus(amount));
  }
  const inTransit = credited ? ZERO : amount;
  const consolidatedAfter = sum([...balances.values()]).plus(inTransit);

  return {
    ok: true,
    status: credited ? "settled" : "in_transit",
    balances: input.accounts.map((a) => ({
      accountId: a.accountId,
      balance: toMoney(balances.get(a.accountId) ?? ZERO),
    })),
    inTransit: toMoney(inTransit),
    consolidatedBefore: toMoney(consolidatedBefore),
    consolidatedAfter: toMoney(consolidatedAfter),
    variation: toMoney(consolidatedAfter.minus(consolidatedBefore)),
    expense: toMoney(fees),
    income: toMoney(ZERO),
  };
}

export type BalanceBasis = "ledger" | "computed" | "opening_only";

export type AccountMovement = {
  bookedOn: string;
  amount: string;
  fromLedger: boolean;
};

export type AccountBalance = {
  balance: string;
  asOf: string;
  basis: BalanceBasis;
  movements: number;
  ledgerMovements: number;
  importedMovements: number;
};

/**
 * BAN-01 : le solde n'est pas stocké. Il vaut le solde d'ouverture plus les
 * mouvements retenus, et il porte sa base : `ledger` quand toutes les lignes
 * viennent du grand livre, `computed` dès qu'une ligne vient d'un import,
 * `opening_only` quand aucun mouvement n'est encore connu. Aucun montant n'est
 * affiché sans cette base.
 */
export function bankBalanceAt(input: {
  openingBalance: string;
  openingBalanceOn?: string | null | undefined;
  movements: readonly AccountMovement[];
  asOf: string;
}): AccountBalance {
  // The opening balance is the balance at the close of `openingBalanceOn`:
  // a movement booked that day is already inside it.
  const after = input.openingBalanceOn ?? null;
  const counted = input.movements.filter(
    (movement) => movement.bookedOn <= input.asOf && (after === null || movement.bookedOn > after),
  );
  const balance = sum([money(input.openingBalance), ...counted.map((m) => money(m.amount))]);
  const ledgerMovements = counted.filter((movement) => movement.fromLedger).length;
  const lastBookedOn = counted
    .map((movement) => movement.bookedOn)
    .sort()
    .at(-1);
  const basis: BalanceBasis =
    counted.length === 0
      ? "opening_only"
      : ledgerMovements === counted.length
        ? "ledger"
        : "computed";
  return {
    balance: toMoney(balance),
    asOf: lastBookedOn ?? input.openingBalanceOn ?? input.asOf,
    basis,
    movements: counted.length,
    ledgerMovements,
    importedMovements: counted.length - ledgerMovements,
  };
}

export type ScenarioAssumptions = {
  price: string;
  fees: string;
  works: string;
  equity: string;
  loanAmount: string;
  loanAnnualRate: string;
  loanMonths: number;
  expectedRentYearly: string;
  chargesYearly: string;
  vacancyRate?: string | undefined;
  unpaidRate?: string | undefined;
};

export type ScenarioOutcome = {
  totalBudget: string;
  financed: string;
  financingGap: string;
  effectiveRentYearly: string;
  netOperatingIncomeYearly: string;
  monthlyInstallment: string;
  monthlyCashflow: string;
  yearlyCashflow: string;
  grossYield: string;
  netYield: string;
};

const percent = (numerator: Decimal, denominator: Decimal): string =>
  denominator.isZero() ? "0.00" : toMoney(numerator.dividedBy(denominator).times(100));

/**
 * ACQ-01 : une hypothèse chiffrée, pas une promesse de rendement. La vacance et
 * les impayés s'appliquent au loyer attendu ; l'impôt n'est pas modélisé.
 */
export function acquisitionOutcome(input: ScenarioAssumptions): ScenarioOutcome {
  const price = money(input.price);
  const fees = money(input.fees);
  const works = money(input.works);
  const totalBudget = price.plus(fees).plus(works);
  const financed = money(input.loanAmount).plus(money(input.equity));

  const rent = money(input.expectedRentYearly);
  const losses = decimal(input.vacancyRate ?? "0").plus(decimal(input.unpaidRate ?? "0"));
  const effectiveRent = roundCent(rent.times(Decimal.max(ZERO, Decimal.sub(1, losses))));
  const noi = effectiveRent.minus(money(input.chargesYearly));

  const schedule =
    input.loanMonths > 0 && !money(input.loanAmount).isZero()
      ? buildSchedule({
          principal: toMoney(money(input.loanAmount)),
          annualNominalRate: input.loanAnnualRate,
          months: input.loanMonths,
          firstDueDate: "2026-01-01",
        })
      : null;
  const firstInstallment = schedule?.installments.find((line) => !line.deferred);
  const monthly = money(firstInstallment?.total ?? "0.00");

  const yearlyCashflow = noi.minus(monthly.times(12));
  return {
    totalBudget: toMoney(totalBudget),
    financed: toMoney(financed),
    financingGap: toMoney(totalBudget.minus(financed)),
    effectiveRentYearly: toMoney(effectiveRent),
    netOperatingIncomeYearly: toMoney(noi),
    monthlyInstallment: toMoney(monthly),
    monthlyCashflow: toMoney(yearlyCashflow.dividedBy(12)),
    yearlyCashflow: toMoney(yearlyCashflow),
    grossYield: percent(rent, totalBudget),
    netYield: percent(noi, totalBudget),
  };
}
