import "server-only";
import type { Claim, ClaimIndemnity, InsurancePolicy } from "@lfsci/contracts";
import type { tables } from "@lfsci/db";
import { certificateDueOn, certificateState } from "@lfsci/domain";
import type {
  CertificateState,
  ClaimIndemnityRow,
  PolicyScopeRow,
  PolicyScopeTargetKind,
} from "@/lib/contracts/assurances";
import { amount, amountOrNull, instant, instantOrNow } from "../finance/shared";

type PolicyRowIn = typeof tables.insurancePolicy.$inferSelect;
type PolicyScopeRowIn = typeof tables.policyScope.$inferSelect;
type ClaimRowIn = typeof tables.claim.$inferSelect;
type ClaimIndemnityRowIn = typeof tables.claimIndemnity.$inferSelect;

function audited(row: { createdAt: string; updatedAt: string | null; version: number }) {
  return {
    createdAt: instantOrNow(row.createdAt),
    updatedAt: instant(row.updatedAt),
    version: row.version,
  };
}

export function mapPolicy(row: PolicyRowIn): InsurancePolicy & {
  lastCertificateDocumentId: string | null;
} {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    kind: row.kind as InsurancePolicy["kind"],
    insurerName: row.insurerName,
    policyNumber: row.policyNumber,
    insuredPersonId: row.insuredPersonId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    premiumAmount: amountOrNull(row.premiumAmount),
    premiumPeriodicity: row.premiumPeriodicity as InsurancePolicy["premiumPeriodicity"],
    deductibleAmount: amountOrNull(row.deductibleAmount),
    currency: row.currency,
    guaranteesSummary: row.guaranteesSummary,
    exclusionsSummary: row.exclusionsSummary,
    contractDocumentId: row.contractDocumentId,
    lastCertificateDocumentId: row.lastCertificateDocumentId,
    lastCertificateCheckedAt: instant(row.lastCertificateCheckedAt),
    status: row.status as InsurancePolicy["status"],
  };
}

export function policyCertificate(
  row: PolicyRowIn,
  today: string,
): { certificateState: CertificateState; certificateDueOn: string | null } {
  return {
    certificateState: certificateState({
      hasCertificate: row.lastCertificateDocumentId !== null,
      coverEndsOn: row.endsOn,
      today,
    }),
    certificateDueOn: row.endsOn === null ? null : certificateDueOn(row.endsOn, today),
  };
}

export function scopeTargetOf(row: PolicyScopeRowIn): {
  kind: PolicyScopeTargetKind;
  id: string;
} {
  if (row.buildingId) return { kind: "building", id: row.buildingId };
  if (row.unitId) return { kind: "unit", id: row.unitId };
  if (row.equipmentId) return { kind: "equipment", id: row.equipmentId };
  if (row.leaseId) return { kind: "lease", id: row.leaseId };
  if (row.loanId) return { kind: "loan", id: row.loanId };
  throw new Error(`policy_scope ${row.id} references no object`);
}

export function mapPolicyScope(row: PolicyScopeRowIn, label: string): PolicyScopeRow {
  return {
    id: row.id,
    ...audited(row),
    policyId: row.policyId,
    buildingId: row.buildingId,
    unitId: row.unitId,
    equipmentId: row.equipmentId,
    leaseId: row.leaseId,
    loanId: row.loanId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    targetKind: scopeTargetOf(row).kind,
    label,
  };
}

export function mapClaim(row: ClaimRowIn): Claim {
  return {
    id: row.id,
    ...audited(row),
    policyId: row.policyId,
    buildingId: row.buildingId,
    unitId: row.unitId,
    leaseId: row.leaseId,
    reference: row.reference,
    insurerClaimNumber: row.insurerClaimNumber,
    occurredOn: row.occurredOn,
    declaredOn: row.declaredOn,
    facts: row.facts,
    allegedLiability: row.allegedLiability,
    acknowledgedLiability: row.acknowledgedLiability,
    expertName: row.expertName,
    expertVisitOn: row.expertVisitOn,
    estimatedDamage: amountOrNull(row.estimatedDamage),
    indemnityExpected: amountOrNull(row.indemnityExpected),
    indemnityReceived: amountOrNull(row.indemnityReceived),
    deductibleApplied: amountOrNull(row.deductibleApplied),
    currency: row.currency,
    deadlineOn: row.deadlineOn,
    status: row.status as Claim["status"],
  };
}

export function mapIndemnity(
  row: ClaimIndemnityRowIn,
  paymentReference: string | null,
): ClaimIndemnityRow {
  return {
    id: row.id,
    ...audited(row),
    claimId: row.claimId,
    amount: amount(row.amount),
    currency: row.currency,
    receivedOn: row.receivedOn,
    paymentId: row.paymentId,
    kind: row.kind as ClaimIndemnity["kind"],
    paymentReference,
  };
}
