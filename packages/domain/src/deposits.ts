import { money, sum, toMoney } from "./money";
import { addMonthsIso, type IsoDateString } from "./periods";
import { type Blocked, blocked } from "./result";

export type Deduction = {
  id: string;
  amount: string;
  justificationIds: readonly string[];
  alreadyBooked?: boolean | undefined;
};

export type DepositSettlement =
  | {
      ok: true;
      depositHeld: string;
      totalDeductions: string;
      restitution: string;
      deadline: IsoDateString;
      deadlineMonths: 1 | 2;
      deductions: { id: string; amount: string; alreadyBooked: boolean }[];
    }
  | Blocked<"deduction_without_justification" | "deductions_exceed_deposit" | "negative_deduction">;

// EDL-03 : un mois si l'état des lieux de sortie est conforme, deux sinon,
// à compter de la remise des clés.
export function settleDeposit(input: {
  depositHeld: string;
  deductions: readonly Deduction[];
  exitInspectionConforms: boolean;
  keyHandoverDate: IsoDateString;
}): DepositSettlement {
  const unjustified = input.deductions
    .filter((d) => d.justificationIds.length === 0)
    .map((d) => d.id);
  if (unjustified.length > 0) return blocked("deduction_without_justification", unjustified);

  const negative = input.deductions.filter((d) => money(d.amount).isNegative()).map((d) => d.id);
  if (negative.length > 0) return blocked("negative_deduction", negative);

  const held = money(input.depositHeld);
  const total = sum(input.deductions.map((d) => money(d.amount)));
  if (total.greaterThan(held)) {
    return blocked(
      "deductions_exceed_deposit",
      input.deductions.map((d) => d.id),
    );
  }

  const deadlineMonths = input.exitInspectionConforms ? 1 : 2;
  return {
    ok: true,
    depositHeld: toMoney(held),
    totalDeductions: toMoney(total),
    restitution: toMoney(held.minus(total)),
    deadline: addMonthsIso(input.keyHandoverDate, deadlineMonths),
    deadlineMonths,
    deductions: input.deductions.map((d) => ({
      id: d.id,
      amount: toMoney(money(d.amount)),
      alreadyBooked: d.alreadyBooked ?? false,
    })),
  };
}
