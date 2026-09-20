import { money, sum, toMoney, ZERO } from "./money";
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
