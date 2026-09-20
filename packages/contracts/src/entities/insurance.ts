import { z } from "zod";
import {
  ClaimStatus,
  InsurancePolicyKind,
  InsurancePolicyPremiumPeriodicity,
  InsurancePolicyStatus,
} from "../enums";
import { Audited, Currency, IsoDate, IsoDateTime, Money, Uuid } from "../primitives";

export const InsurancePolicy = Audited.extend({
  legalEntityId: Uuid.nullable(),
  kind: InsurancePolicyKind,
  insurerName: z.string(),
  policyNumber: z.string(),
  insuredPersonId: Uuid.nullable(),
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
  premiumAmount: Money.nullable(),
  premiumPeriodicity: InsurancePolicyPremiumPeriodicity.nullable(),
  deductibleAmount: Money.nullable(),
  currency: Currency,
  guaranteesSummary: z.string().nullable(),
  exclusionsSummary: z.string().nullable(),
  contractDocumentId: Uuid.nullable(),
  lastCertificateCheckedAt: IsoDateTime.nullable(),
  status: InsurancePolicyStatus,
});
export type InsurancePolicy = z.infer<typeof InsurancePolicy>;

export const Claim = Audited.extend({
  policyId: Uuid.nullable(),
  buildingId: Uuid.nullable(),
  unitId: Uuid.nullable(),
  leaseId: Uuid.nullable(),
  reference: z.string().nullable(),
  insurerClaimNumber: z.string().nullable(),
  occurredOn: IsoDate.nullable(),
  declaredOn: IsoDate.nullable(),
  facts: z.string().nullable(),
  allegedLiability: z.string().nullable(),
  acknowledgedLiability: z.string().nullable(),
  expertName: z.string().nullable(),
  expertVisitOn: IsoDate.nullable(),
  estimatedDamage: Money.nullable(),
  indemnityExpected: Money.nullable(),
  indemnityReceived: Money.nullable(),
  deductibleApplied: Money.nullable(),
  currency: Currency,
  deadlineOn: IsoDate.nullable(),
  status: ClaimStatus,
});
export type Claim = z.infer<typeof Claim>;
