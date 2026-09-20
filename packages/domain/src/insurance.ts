import { money, sum, toMoney } from "./money";
import { addDaysIso, compareIsoDates, type IsoDateString } from "./periods";

export const CERTIFICATE_NOTICE_DAYS = 30;

export type CertificateState = "missing" | "expired" | "expiring" | "valid";

export type CertificateInput = {
  hasCertificate: boolean;
  coverEndsOn: IsoDateString | null;
  today: IsoDateString;
  noticeDays?: number | undefined;
};

/**
 * ASS-01: a missing or expired certificate is an exception, so absence and
 * lapse are two distinct states and neither collapses into "valid".
 */
export function certificateState(input: CertificateInput): CertificateState {
  if (!input.hasCertificate) return "missing";
  if (input.coverEndsOn === null) return "valid";
  if (compareIsoDates(input.coverEndsOn, input.today) < 0) return "expired";
  const notice = input.noticeDays ?? CERTIFICATE_NOTICE_DAYS;
  return compareIsoDates(input.coverEndsOn, addDaysIso(input.today, notice)) <= 0
    ? "expiring"
    : "valid";
}

export function isCertificateException(state: CertificateState): boolean {
  return state === "missing" || state === "expired";
}

/** The renewal is due `noticeDays` before the cover ends, never in the past. */
export function certificateDueOn(
  coverEndsOn: IsoDateString,
  today: IsoDateString,
  noticeDays: number = CERTIFICATE_NOTICE_DAYS,
): IsoDateString {
  const due = addDaysIso(coverEndsOn, -noticeDays);
  return compareIsoDates(due, today) < 0 ? today : due;
}

export type ClaimExpenseInput = { id: string; amount: string };
export type ClaimIndemnityInput = { id: string; amount: string; kind: string };

export type ClaimBalance = {
  grossCost: string;
  grossIndemnities: string;
  deductible: string;
  remainingCost: string;
  expected: string | null;
  stillExpected: string | null;
  expenseCount: number;
  indemnityCount: number;
};

/**
 * SIN-01: repairs and indemnities are reconciled without netting. The gross
 * figures are reported side by side; `remainingCost` is their difference, a
 * derived reading that never replaces either one. A `deductible` line is the
 * part the insurer withheld, so it is reported apart and not counted as cash in.
 */
export function claimBalance(input: {
  expenses: readonly ClaimExpenseInput[];
  indemnities: readonly ClaimIndemnityInput[];
  deductibleApplied?: string | null | undefined;
  indemnityExpected?: string | null | undefined;
}): ClaimBalance {
  const grossCost = sum(input.expenses.map((expense) => money(expense.amount)));
  const received = input.indemnities.filter((line) => line.kind !== "deductible");
  const withheld = input.indemnities.filter((line) => line.kind === "deductible");
  const grossIndemnities = sum(received.map((line) => money(line.amount)));
  const deductible = sum([
    ...withheld.map((line) => money(line.amount)),
    ...(input.deductibleApplied ? [money(input.deductibleApplied)] : []),
  ]);
  const expected = input.indemnityExpected ? money(input.indemnityExpected) : null;

  return {
    grossCost: toMoney(grossCost),
    grossIndemnities: toMoney(grossIndemnities),
    deductible: toMoney(deductible),
    remainingCost: toMoney(grossCost.minus(grossIndemnities)),
    expected: expected === null ? null : toMoney(expected),
    stillExpected: expected === null ? null : toMoney(expected.minus(grossIndemnities)),
    expenseCount: input.expenses.length,
    indemnityCount: input.indemnities.length,
  };
}

export type MatchSignal = "policy_number" | "insurer" | "insured_name" | "period";

const SIGNAL_WEIGHT: Record<MatchSignal, number> = {
  policy_number: 60,
  insurer: 20,
  insured_name: 10,
  period: 10,
};

/** Below this, nothing but a policy number match can carry a proposal. */
export const MATCH_CONFIDENT_SCORE = SIGNAL_WEIGHT.policy_number;

export type AttestationFields = {
  insurer: string | null;
  policyNumber: string | null;
  insuredName: string | null;
  validFrom: IsoDateString | null;
  validTo: IsoDateString | null;
};

export type PolicyCandidate = {
  id: string;
  insurerName: string;
  policyNumber: string;
  insuredName: string | null;
  startsOn: IsoDateString | null;
  endsOn: IsoDateString | null;
};

export type AttestationMatch = {
  policyId: string;
  score: number;
  matchedOn: MatchSignal[];
  conflicts: MatchSignal[];
  confident: boolean;
};

function normalise(value: string | null): string {
  if (value === null) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function namesOverlap(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  return a.includes(b) || b.includes(a);
}

function withinCover(
  candidate: PolicyCandidate,
  validFrom: IsoDateString | null,
): boolean | undefined {
  if (validFrom === null) return undefined;
  if (candidate.startsOn === null && candidate.endsOn === null) return undefined;
  const afterStart =
    candidate.startsOn === null || compareIsoDates(validFrom, candidate.startsOn) >= 0;
  const beforeEnd = candidate.endsOn === null || compareIsoDates(validFrom, candidate.endsOn) <= 0;
  return afterStart && beforeEnd;
}

/**
 * ASS-01: the proposal says what it matched on, so the owner checks identity,
 * property, cover and dates before the alert is closed; an uncertain extraction
 * stays to be verified rather than being attached silently.
 */
export function matchAttestation(
  fields: AttestationFields,
  candidates: readonly PolicyCandidate[],
): AttestationMatch[] {
  const extractedNumber = normalise(fields.policyNumber);
  const extractedInsurer = normalise(fields.insurer);
  const extractedInsured = normalise(fields.insuredName);

  return candidates
    .map((candidate) => {
      const matchedOn: MatchSignal[] = [];
      const conflicts: MatchSignal[] = [];

      const candidateNumber = normalise(candidate.policyNumber);
      if (extractedNumber !== "") {
        if (candidateNumber === extractedNumber) matchedOn.push("policy_number");
        else conflicts.push("policy_number");
      }

      const candidateInsurer = normalise(candidate.insurerName);
      if (extractedInsurer !== "") {
        if (namesOverlap(candidateInsurer, extractedInsurer)) matchedOn.push("insurer");
        else conflicts.push("insurer");
      }

      const candidateInsured = normalise(candidate.insuredName);
      if (extractedInsured !== "" && candidateInsured !== "") {
        if (namesOverlap(candidateInsured, extractedInsured)) matchedOn.push("insured_name");
        else conflicts.push("insured_name");
      }

      const covered = withinCover(candidate, fields.validFrom);
      if (covered === true) matchedOn.push("period");
      if (covered === false) conflicts.push("period");

      const score = matchedOn.reduce((total, signal) => total + SIGNAL_WEIGHT[signal], 0);
      return {
        policyId: candidate.id,
        score,
        matchedOn,
        conflicts,
        confident: matchedOn.includes("policy_number") && conflicts.length === 0,
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.policyId.localeCompare(b.policyId));
}
