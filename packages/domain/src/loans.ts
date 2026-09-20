import { Decimal } from "decimal.js";
import { decimal, money, roundCent, sum, toMoney, ZERO } from "./money";
import { addMonthsIso, type IsoDateString } from "./periods";
import { type Blocked, blocked } from "./result";

export type DeferralKind = "partial" | "total";

/**
 * CRE-01 : la prime d'assurance se calcule sur le capital initial chez la
 * plupart des prêteurs, sur le capital restant dû chez d'autres. Le choix est
 * porté par le crédit et se lit dans l'échéancier qu'il a produit.
 */
export type InsuranceBasis = "initial_principal" | "outstanding_principal";

export type InsurancePolicy = { basis: InsuranceBasis; annualRate: string };

export type LoanInput = {
  principal: string;
  annualNominalRate: string;
  months: number;
  insuranceMonthly?: string | undefined;
  insurance?: InsurancePolicy | undefined;
  feesMonthly?: string | undefined;
  firstDueDate: IsoDateString;
  deferral?: { months: number; kind: DeferralKind } | undefined;
};

export type Installment = {
  number: number;
  dueDate: IsoDateString;
  capital: string;
  interest: string;
  insurance: string;
  fees: string;
  total: string;
  remainingPrincipal: string;
  deferred: boolean;
};

export type LoanSchedule = {
  installments: Installment[];
  totalCapital: string;
  totalInterest: string;
  totalInsurance: string;
  totalFees: string;
  totalPaid: string;
};

function annuity(principal: Decimal, rate: Decimal, months: number): Decimal {
  if (months <= 0) return ZERO;
  if (rate.isZero()) return principal.dividedBy(months);
  const growth = rate.plus(1).pow(-months);
  return principal.times(rate).dividedBy(Decimal.sub(1, growth));
}

// Différé partiel : intérêts et assurance payés, capital intact.
// Différé total : intérêts capitalisés, rien n'est prélevé.
export function buildSchedule(input: LoanInput): LoanSchedule {
  const monthlyRate = decimal(input.annualNominalRate).dividedBy(12);
  const flatInsurance = roundCent(money(input.insuranceMonthly ?? "0.00"));
  const insuranceRate =
    input.insurance === undefined ? ZERO : decimal(input.insurance.annualRate).dividedBy(12);
  const principal = money(input.principal);
  const premiumOn = (outstanding: Decimal): Decimal => {
    if (input.insurance === undefined) return flatInsurance;
    const base = input.insurance.basis === "initial_principal" ? principal : outstanding;
    return roundCent(base.times(insuranceRate));
  };
  const fees = roundCent(money(input.feesMonthly ?? "0.00"));
  const deferralMonths = Math.max(0, Math.min(input.deferral?.months ?? 0, input.months));
  const deferralKind: DeferralKind = input.deferral?.kind ?? "partial";

  let remaining = principal;
  const installments: Installment[] = [];

  for (let n = 1; n <= deferralMonths; n += 1) {
    const interest = roundCent(remaining.times(monthlyRate));
    const insurance = premiumOn(remaining);
    if (deferralKind === "total") remaining = remaining.plus(interest);
    const paidInterest = deferralKind === "total" ? ZERO : interest;
    const paidInsurance = deferralKind === "total" ? ZERO : insurance;
    const paidFees = deferralKind === "total" ? ZERO : fees;
    installments.push({
      number: n,
      dueDate: addMonthsIso(input.firstDueDate, n - 1),
      capital: toMoney(ZERO),
      interest: toMoney(paidInterest),
      insurance: toMoney(paidInsurance),
      fees: toMoney(paidFees),
      total: toMoney(paidInterest.plus(paidInsurance).plus(paidFees)),
      remainingPrincipal: toMoney(remaining),
      deferred: true,
    });
  }

  const amortMonths = input.months - deferralMonths;
  const payment = roundCent(annuity(remaining, monthlyRate, amortMonths));
  for (let k = 1; k <= amortMonths; k += 1) {
    const n = deferralMonths + k;
    const interest = roundCent(remaining.times(monthlyRate));
    const insurance = premiumOn(remaining);
    const capital = k === amortMonths ? remaining : Decimal.min(payment.minus(interest), remaining);
    remaining = remaining.minus(capital);
    installments.push({
      number: n,
      dueDate: addMonthsIso(input.firstDueDate, n - 1),
      capital: toMoney(capital),
      interest: toMoney(interest),
      insurance: toMoney(insurance),
      fees: toMoney(fees),
      total: toMoney(capital.plus(interest).plus(insurance).plus(fees)),
      remainingPrincipal: toMoney(remaining),
      deferred: false,
    });
  }

  const pick = (key: "capital" | "interest" | "insurance" | "fees" | "total"): Decimal =>
    sum(installments.map((i) => money(i[key])));

  return {
    installments,
    totalCapital: toMoney(pick("capital")),
    totalInterest: toMoney(pick("interest")),
    totalInsurance: toMoney(pick("insurance")),
    totalFees: toMoney(pick("fees")),
    totalPaid: toMoney(pick("total")),
  };
}

export type InstallmentSplit = {
  capital: string;
  interest: string;
  insurance: string;
  fees?: string | undefined;
};

export type AppliedInstallment =
  | {
      ok: true;
      principalBefore: string;
      principalAfter: string;
      capitalRepaid: string;
      expense: string;
      cash: string;
      total: string;
    }
  | Blocked<"components_do_not_sum" | "capital_exceeds_principal">;

// CRE-02 : le remboursement de capital diminue la dette, il n'est jamais une charge.
export function applyInstallment(input: {
  outstandingPrincipal: string;
  debitedAmount: string;
  split: InstallmentSplit;
}): AppliedInstallment {
  const capital = money(input.split.capital);
  const interest = money(input.split.interest);
  const insurance = money(input.split.insurance);
  const fees = money(input.split.fees ?? "0.00");
  const total = capital.plus(interest).plus(insurance).plus(fees);
  const debited = money(input.debitedAmount);
  if (!total.equals(debited)) return blocked("components_do_not_sum", ["split"]);

  const before = money(input.outstandingPrincipal);
  if (capital.greaterThan(before)) return blocked("capital_exceeds_principal", ["split.capital"]);

  const expense = interest.plus(insurance).plus(fees);
  return {
    ok: true,
    principalBefore: toMoney(before),
    principalAfter: toMoney(before.minus(capital)),
    capitalRepaid: toMoney(capital),
    expense: toMoney(expense),
    cash: toMoney(debited.negated()),
    total: toMoney(total),
  };
}

export type DebitMatch =
  | { ok: true; kind: "exact"; amount: string }
  | (Blocked<"amount_mismatch"> & { difference: string });

export function matchDebit(expectedInstallment: string, bankAmount: string): DebitMatch {
  const expected = money(expectedInstallment);
  const actual = money(bankAmount);
  if (expected.equals(actual)) return { ok: true, kind: "exact", amount: toMoney(expected) };
  return { ...blocked("amount_mismatch"), difference: toMoney(actual.minus(expected)) };
}

export type ScheduleLine = {
  dueDate: IsoDateString;
  capital: string;
  interest: string;
  insurance: string;
  fees: string;
  total: string;
  remainingPrincipal?: string | null | undefined;
};

/**
 * CRE-01 : le capital restant dû prévisionnel se lit sur l'échéancier, jamais
 * sur une soustraction de totaux. Avant la première échéance, c'est le capital
 * emprunté ; après la dernière, ce que l'échéancier laisse.
 */
export function outstandingPrincipalAt(input: {
  principal: string;
  installments: readonly ScheduleLine[];
  on: IsoDateString;
}): string {
  const past = input.installments.filter((line) => line.dueDate <= input.on);
  const last = past.at(-1);
  if (last === undefined) return toMoney(money(input.principal));
  if (last.remainingPrincipal !== null && last.remainingPrincipal !== undefined) {
    return toMoney(money(last.remainingPrincipal));
  }
  const repaid = sum(past.map((line) => money(line.capital)));
  return toMoney(money(input.principal).minus(repaid));
}

export type ScheduleProgress = {
  asOf: IsoDateString;
  outstandingPrincipal: string;
  capitalRepaid: string;
  interestPaid: string;
  insurancePaid: string;
  feesPaid: string;
  installmentsPaid: number;
  installmentsLeft: number;
  nextDueOn: IsoDateString | null;
  nextAmount: string | null;
};

export function scheduleProgress(input: {
  principal: string;
  installments: readonly ScheduleLine[];
  on: IsoDateString;
}): ScheduleProgress {
  const past = input.installments.filter((line) => line.dueDate <= input.on);
  const future = input.installments.filter((line) => line.dueDate > input.on);
  const next = future[0];
  return {
    asOf: input.on,
    outstandingPrincipal: outstandingPrincipalAt(input),
    capitalRepaid: toMoney(sum(past.map((line) => money(line.capital)))),
    interestPaid: toMoney(sum(past.map((line) => money(line.interest)))),
    insurancePaid: toMoney(sum(past.map((line) => money(line.insurance)))),
    feesPaid: toMoney(sum(past.map((line) => money(line.fees)))),
    installmentsPaid: past.length,
    installmentsLeft: future.length,
    nextDueOn: next?.dueDate ?? null,
    nextAmount: next === undefined ? null : toMoney(money(next.total)),
  };
}

export type ReadInsuranceBasis = InsuranceBasis | "none" | "unknown";

/**
 * Which rule the stored schedule actually follows. A constant premium is the
 * initial-principal rule; a premium falling with the outstanding capital is the
 * other one. Anything else — an imported lender schedule, a mid-life change —
 * reads `unknown` rather than a guess.
 */
export function insuranceBasisOf(installments: readonly ScheduleLine[]): ReadInsuranceBasis {
  const premiums = installments.map((line) => money(line.insurance));
  if (premiums.length === 0) return "unknown";
  if (premiums.every((premium) => premium.isZero())) return "none";
  const paying = installments.filter((line) => !money(line.insurance).isZero());
  const first = paying[0];
  if (first === undefined) return "none";
  if (paying.every((line) => money(line.insurance).equals(money(first.insurance)))) {
    return "initial_principal";
  }
  const decreasing = paying.every((line, index) => {
    if (index === 0) return true;
    const previous = paying[index - 1];
    return (
      previous !== undefined && money(line.insurance).lessThanOrEqualTo(money(previous.insurance))
    );
  });
  return decreasing ? "outstanding_principal" : "unknown";
}
