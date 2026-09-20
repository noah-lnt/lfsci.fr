import {
  Claim,
  ClaimIndemnity,
  ClaimStatus,
  InsurancePolicy,
  InsurancePolicyKind,
  InsurancePolicyPremiumPeriodicity,
  InsurancePolicyStatus,
  IsoDate,
  IsoDateTime,
  Money,
  Page,
  PolicyScope,
  paginated,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** ASS-01: absence and lapse are distinct; neither collapses into "valid". */
export const CertificateState = z.enum(["missing", "expired", "expiring", "valid"]);
export type CertificateState = z.infer<typeof CertificateState>;

export const MatchSignal = z.enum(["policy_number", "insurer", "insured_name", "period"]);
export type MatchSignal = z.infer<typeof MatchSignal>;

export const PolicyScopeTargetKind = z.enum(["building", "unit", "equipment", "lease", "loan"]);
export type PolicyScopeTargetKind = z.infer<typeof PolicyScopeTargetKind>;

export const PolicyRow = InsurancePolicy.extend({
  lastCertificateDocumentId: Uuid.nullable(),
  certificateState: CertificateState,
  certificateDueOn: IsoDate.nullable(),
  scopeLabels: z.array(z.string()),
  claimCount: z.number().int().min(0),
});
export type PolicyRow = z.infer<typeof PolicyRow>;

export const PolicyScopeRow = PolicyScope.extend({
  targetKind: PolicyScopeTargetKind,
  label: z.string(),
});
export type PolicyScopeRow = z.infer<typeof PolicyScopeRow>;

export const PolicyDeadlineRow = z.object({
  id: Uuid,
  title: z.string(),
  dueOn: IsoDate,
  status: z.string(),
});
export type PolicyDeadlineRow = z.infer<typeof PolicyDeadlineRow>;

export const PolicyDetail = PolicyRow.extend({
  legalEntityName: z.string().nullable(),
  insuredPersonName: z.string().nullable(),
  scopes: z.array(PolicyScopeRow),
  deadlines: z.array(PolicyDeadlineRow),
});
export type PolicyDetail = z.infer<typeof PolicyDetail>;

export const CreatePolicyInput = z.strictObject({
  kind: InsurancePolicyKind,
  insurerName: z.string().min(1).max(200),
  policyNumber: z.string().min(1).max(80),
  legalEntityId: Uuid.optional(),
  insuredPersonId: Uuid.optional(),
  startsOn: IsoDate.optional(),
  endsOn: IsoDate.optional(),
  premiumAmount: Money.optional(),
  premiumPeriodicity: InsurancePolicyPremiumPeriodicity.optional(),
  deductibleAmount: Money.optional(),
  guaranteesSummary: z.string().max(4000).optional(),
  exclusionsSummary: z.string().max(4000).optional(),
});
export type CreatePolicyInput = z.infer<typeof CreatePolicyInput>;

export const UpdatePolicyInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  kind: InsurancePolicyKind.optional(),
  insurerName: z.string().min(1).max(200).optional(),
  policyNumber: z.string().min(1).max(80).optional(),
  legalEntityId: Uuid.nullable().optional(),
  insuredPersonId: Uuid.nullable().optional(),
  startsOn: IsoDate.nullable().optional(),
  endsOn: IsoDate.nullable().optional(),
  premiumAmount: Money.nullable().optional(),
  premiumPeriodicity: InsurancePolicyPremiumPeriodicity.nullable().optional(),
  deductibleAmount: Money.nullable().optional(),
  guaranteesSummary: z.string().max(4000).nullable().optional(),
  exclusionsSummary: z.string().max(4000).nullable().optional(),
  status: InsurancePolicyStatus.optional(),
});
export type UpdatePolicyInput = z.infer<typeof UpdatePolicyInput>;

export const AddPolicyScopeInput = z.strictObject({
  policyId: Uuid,
  targetKind: PolicyScopeTargetKind,
  targetId: Uuid,
  startsOn: IsoDate.optional(),
  endsOn: IsoDate.optional(),
});
export type AddPolicyScopeInput = z.infer<typeof AddPolicyScopeInput>;

/** No delete path in the schema: a scope is ended on a date, never erased. */
export const ClosePolicyScopeInput = z.strictObject({
  policyId: Uuid,
  scopeId: Uuid,
  expectedVersion: Version,
  endsOn: IsoDate,
});
export type ClosePolicyScopeInput = z.infer<typeof ClosePolicyScopeInput>;

export const PolicyExceptionRow = z.object({
  policyId: Uuid,
  label: z.string(),
  insurerName: z.string(),
  kind: InsurancePolicyKind,
  certificateState: CertificateState,
  coverEndsOn: IsoDate.nullable(),
  scopeLabels: z.array(z.string()),
});
export type PolicyExceptionRow = z.infer<typeof PolicyExceptionRow>;

export const ExtractedAttestation = z.object({
  insurer: z.string().nullable(),
  policyNumber: z.string().nullable(),
  insuredName: z.string().nullable(),
  address: z.string().nullable(),
  validFrom: IsoDate.nullable(),
  validTo: IsoDate.nullable(),
  coverage: z.array(z.string()),
});
export type ExtractedAttestation = z.infer<typeof ExtractedAttestation>;

export const AttestationProposal = z.object({
  policyId: Uuid,
  policyLabel: z.string(),
  score: z.number().int().min(0),
  matchedOn: z.array(MatchSignal),
  conflicts: z.array(MatchSignal),
  confident: z.boolean(),
});
export type AttestationProposal = z.infer<typeof AttestationProposal>;

export const AttestationCandidate = z.object({
  inboxItemId: Uuid,
  version: Version,
  receivedAt: IsoDateTime,
  documentId: Uuid.nullable(),
  summary: z.string().nullable(),
  uncertaintyReason: z.string().nullable(),
  extracted: ExtractedAttestation,
  proposals: z.array(AttestationProposal),
});
export type AttestationCandidate = z.infer<typeof AttestationCandidate>;

/**
 * ASS-01: identity, property, cover and dates are checked before the alert is
 * closed, so the four confirmations travel with the attachment.
 */
export const AttestationChecks = z.object({
  identity: z.boolean(),
  property: z.boolean(),
  cover: z.boolean(),
  dates: z.boolean(),
});
export type AttestationChecks = z.infer<typeof AttestationChecks>;

export const AttachAttestationInput = z.strictObject({
  inboxItemId: Uuid,
  expectedVersion: Version,
  policyId: Uuid,
  documentId: Uuid,
  coverEndsOn: IsoDate.optional(),
  checks: AttestationChecks,
});
export type AttachAttestationInput = z.infer<typeof AttachAttestationInput>;

export const AttachAttestationResult = z.object({
  policy: PolicyDetail,
  closedDeadlineCount: z.number().int().min(0),
  nextDeadlineOn: IsoDate.nullable(),
});
export type AttachAttestationResult = z.infer<typeof AttachAttestationResult>;

export const ClaimBalanceView = z.object({
  grossCost: Money,
  grossIndemnities: Money,
  deductible: Money,
  remainingCost: Money,
  expected: Money.nullable(),
  stillExpected: Money.nullable(),
  expenseCount: z.number().int().min(0),
  indemnityCount: z.number().int().min(0),
});
export type ClaimBalanceView = z.infer<typeof ClaimBalanceView>;

export const ClaimRow = Claim.extend({
  policyLabel: z.string().nullable(),
  unitLabel: z.string().nullable(),
  buildingLabel: z.string().nullable(),
  balance: ClaimBalanceView,
});
export type ClaimRow = z.infer<typeof ClaimRow>;

export const ClaimExpenseRow = z.object({
  id: Uuid,
  interventionId: Uuid,
  interventionTitle: z.string(),
  supplierName: z.string().nullable(),
  issuedOn: IsoDate.nullable(),
  totalInclTax: Money,
  currency: z.string(),
  status: z.string(),
});
export type ClaimExpenseRow = z.infer<typeof ClaimExpenseRow>;

export const ClaimInterventionRow = z.object({
  id: Uuid,
  version: Version,
  title: z.string(),
  status: z.string(),
  unitId: Uuid.nullable(),
  completedOn: IsoDate.nullable(),
});
export type ClaimInterventionRow = z.infer<typeof ClaimInterventionRow>;

export const ClaimIndemnityRow = ClaimIndemnity.extend({
  paymentReference: z.string().nullable(),
});
export type ClaimIndemnityRow = z.infer<typeof ClaimIndemnityRow>;

export const ClaimDetail = ClaimRow.extend({
  expenses: z.array(ClaimExpenseRow),
  interventions: z.array(ClaimInterventionRow),
  indemnities: z.array(ClaimIndemnityRow),
});
export type ClaimDetail = z.infer<typeof ClaimDetail>;

export const CreateClaimInput = z.strictObject({
  policyId: Uuid.optional(),
  buildingId: Uuid.optional(),
  unitId: Uuid.optional(),
  leaseId: Uuid.optional(),
  reference: z.string().max(80).optional(),
  insurerClaimNumber: z.string().max(80).optional(),
  occurredOn: IsoDate.optional(),
  declaredOn: IsoDate.optional(),
  facts: z.string().max(8000).optional(),
  allegedLiability: z.string().max(2000).optional(),
  estimatedDamage: Money.optional(),
  deadlineOn: IsoDate.optional(),
});
export type CreateClaimInput = z.infer<typeof CreateClaimInput>;

export const UpdateClaimInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  policyId: Uuid.nullable().optional(),
  buildingId: Uuid.nullable().optional(),
  unitId: Uuid.nullable().optional(),
  reference: z.string().max(80).nullable().optional(),
  insurerClaimNumber: z.string().max(80).nullable().optional(),
  occurredOn: IsoDate.nullable().optional(),
  declaredOn: IsoDate.nullable().optional(),
  facts: z.string().max(8000).nullable().optional(),
  /** SIN-01: what is alleged and what is acknowledged are two separate fields. */
  allegedLiability: z.string().max(2000).nullable().optional(),
  acknowledgedLiability: z.string().max(2000).nullable().optional(),
  expertName: z.string().max(200).nullable().optional(),
  expertVisitOn: IsoDate.nullable().optional(),
  estimatedDamage: Money.nullable().optional(),
  indemnityExpected: Money.nullable().optional(),
  deductibleApplied: Money.nullable().optional(),
  deadlineOn: IsoDate.nullable().optional(),
  status: ClaimStatus.optional(),
});
export type UpdateClaimInput = z.infer<typeof UpdateClaimInput>;

/** The claim's expenses are the ones its interventions carry; nothing else links them. */
export const LinkClaimInterventionInput = z.strictObject({
  claimId: Uuid,
  interventionId: Uuid,
  expectedVersion: Version,
  attached: z.boolean(),
});
export type LinkClaimInterventionInput = z.infer<typeof LinkClaimInterventionInput>;

export const AssurancesRef = z.object({ id: Uuid, label: z.string() });
export type AssurancesRef = z.infer<typeof AssurancesRef>;

export const AssurancesLookups = z.object({
  legalEntities: z.array(AssurancesRef),
  buildings: z.array(AssurancesRef),
  units: z.array(AssurancesRef.extend({ buildingId: Uuid })),
  persons: z.array(AssurancesRef),
  leases: z.array(AssurancesRef),
  loans: z.array(AssurancesRef),
  equipment: z.array(AssurancesRef),
  policies: z.array(AssurancesRef),
  interventions: z.array(AssurancesRef.extend({ claimId: Uuid.nullable(), version: Version })),
});
export type AssurancesLookups = z.infer<typeof AssurancesLookups>;

const listPolicies = z.strictObject({
  ...Page.shape,
  kind: InsurancePolicyKind.optional(),
  status: InsurancePolicyStatus.optional(),
  legalEntityId: Uuid.optional(),
  buildingId: Uuid.optional(),
  unitId: Uuid.optional(),
});

const listClaims = z.strictObject({
  ...Page.shape,
  status: ClaimStatus.optional(),
  policyId: Uuid.optional(),
  unitId: Uuid.optional(),
  openOnly: z.boolean().optional(),
});

export const assurancesContract = {
  assurances: {
    lookups: oc
      .route({ method: "GET", path: "/assurances/lookups", summary: "Listes de sélection" })
      .input(z.strictObject({}))
      .output(AssurancesLookups),
    policies: {
      list: oc
        .route({ method: "GET", path: "/assurances/polices", summary: "Polices d’assurance" })
        .input(listPolicies)
        .output(paginated(PolicyRow)),
      get: oc
        .route({ method: "GET", path: "/assurances/polices/{id}", summary: "Police d’assurance" })
        .input(z.strictObject({ id: Uuid }))
        .output(PolicyDetail),
      create: oc
        .route({ method: "POST", path: "/assurances/polices", summary: "Créer une police" })
        .input(CreatePolicyInput)
        .output(PolicyDetail),
      update: oc
        .route({ method: "PATCH", path: "/assurances/polices/{id}", summary: "Modifier la police" })
        .input(UpdatePolicyInput)
        .output(PolicyDetail),
      exceptions: oc
        .route({
          method: "GET",
          path: "/assurances/polices/exceptions",
          summary: "Attestations manquantes ou expirées",
        })
        .input(z.strictObject({}))
        .output(z.object({ items: z.array(PolicyExceptionRow) })),
      scopes: {
        add: oc
          .route({
            method: "POST",
            path: "/assurances/polices/{policyId}/biens",
            summary: "Ajouter un bien couvert",
          })
          .input(AddPolicyScopeInput)
          .output(PolicyDetail),
        close: oc
          .route({
            method: "POST",
            path: "/assurances/polices/{policyId}/biens/{scopeId}/fin",
            summary: "Clore une couverture",
          })
          .input(ClosePolicyScopeInput)
          .output(PolicyDetail),
      },
    },
    attestations: {
      list: oc
        .route({
          method: "GET",
          path: "/assurances/attestations",
          summary: "Attestations reçues à rattacher",
        })
        .input(z.strictObject({ limit: z.number().int().min(1).max(50).default(20) }))
        .output(z.object({ items: z.array(AttestationCandidate) })),
      attach: oc
        .route({
          method: "POST",
          path: "/assurances/attestations/{inboxItemId}/rattachement",
          summary: "Rattacher l’attestation à sa police",
        })
        .input(AttachAttestationInput)
        .output(AttachAttestationResult),
    },
    claims: {
      list: oc
        .route({ method: "GET", path: "/assurances/sinistres", summary: "Sinistres" })
        .input(listClaims)
        .output(paginated(ClaimRow)),
      get: oc
        .route({ method: "GET", path: "/assurances/sinistres/{id}", summary: "Sinistre" })
        .input(z.strictObject({ id: Uuid }))
        .output(ClaimDetail),
      create: oc
        .route({ method: "POST", path: "/assurances/sinistres", summary: "Déclarer un sinistre" })
        .input(CreateClaimInput)
        .output(ClaimDetail),
      update: oc
        .route({
          method: "PATCH",
          path: "/assurances/sinistres/{id}",
          summary: "Modifier le sinistre",
        })
        .input(UpdateClaimInput)
        .output(ClaimDetail),
      linkIntervention: oc
        .route({
          method: "POST",
          path: "/assurances/sinistres/{claimId}/interventions",
          summary: "Rattacher une intervention au sinistre",
        })
        .input(LinkClaimInterventionInput)
        .output(ClaimDetail),
    },
  },
};
