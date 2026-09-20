import { Currency, IsoDate, IsoDateTime, Money, Share, Uuid, Version } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const AllocationBasis = z.enum([
  "tantiemes",
  "surface",
  "consumption",
  "occupants",
  "equal",
  "contractual",
  "other",
]);
export type AllocationBasis = z.infer<typeof AllocationBasis>;

export const RoundingRule = z.enum([
  "largest_remainder",
  "first_id",
  "last_id",
  "proportional_truncate",
]);
export type RoundingRule = z.infer<typeof RoundingRule>;

export const AllocationShareRead = z.object({
  id: Uuid,
  unitId: Uuid.nullable(),
  buildingId: Uuid.nullable(),
  label: z.string(),
  share: Share,
});
export type AllocationShareRead = z.infer<typeof AllocationShareRead>;

export const AllocationKeyVersionRead = z.object({
  id: Uuid,
  sequence: z.number().int().positive(),
  effectiveFrom: IsoDate,
  effectiveTo: IsoDate.nullable(),
  roundingRule: RoundingRule,
  justification: z.string().nullable(),
  status: z.enum(["draft", "active", "superseded"]),
  shares: z.array(AllocationShareRead),
  sharesTotal: z.string(),
  sharesExact: z.boolean(),
  /** CHA-01 / WF-07: a version a frozen run used is history, not a draft. */
  editable: z.boolean(),
  usedByRunIds: z.array(Uuid),
  version: Version,
});
export type AllocationKeyVersionRead = z.infer<typeof AllocationKeyVersionRead>;

export const AllocationKeyRead = z.object({
  id: Uuid,
  code: z.string(),
  label: z.string(),
  basis: AllocationBasis,
  status: z.enum(["draft", "active", "retired"]),
  buildingId: Uuid.nullable(),
  buildingName: z.string().nullable(),
  legalEntityId: Uuid.nullable(),
  legalEntityName: z.string().nullable(),
  versions: z.array(AllocationKeyVersionRead),
  version: Version,
});
export type AllocationKeyRead = z.infer<typeof AllocationKeyRead>;

const ShareInput = z.strictObject({
  unitId: Uuid.optional(),
  buildingId: Uuid.optional(),
  share: Share,
});

export const CreateAllocationKeyInput = z.strictObject({
  code: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  basis: AllocationBasis,
  buildingId: Uuid.optional(),
  legalEntityId: Uuid.optional(),
  effectiveFrom: IsoDate,
  justification: z.string().min(1).max(2000).optional(),
  roundingRule: RoundingRule.optional(),
  shares: z.array(ShareInput).min(1),
});
export type CreateAllocationKeyInput = z.infer<typeof CreateAllocationKeyInput>;

export const AddKeyVersionInput = z.strictObject({
  keyId: Uuid,
  effectiveFrom: IsoDate,
  justification: z.string().min(1).max(2000).optional(),
  roundingRule: RoundingRule.optional(),
  shares: z.array(ShareInput).min(1),
});
export type AddKeyVersionInput = z.infer<typeof AddKeyVersionInput>;

export const UpdateKeyVersionInput = z.strictObject({
  keyVersionId: Uuid,
  expectedVersion: Version,
  effectiveFrom: IsoDate.optional(),
  justification: z.string().min(1).max(2000).optional(),
  roundingRule: RoundingRule.optional(),
  shares: z.array(ShareInput).min(1).optional(),
});
export type UpdateKeyVersionInput = z.infer<typeof UpdateKeyVersionInput>;

export const ActivateKeyVersionInput = z.strictObject({
  keyVersionId: Uuid,
  expectedVersion: Version,
});
export type ActivateKeyVersionInput = z.infer<typeof ActivateKeyVersionInput>;

export const RunStatus = z.enum([
  "draft",
  "computed",
  "frozen",
  "approved",
  "sent",
  "posted",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RegularizationDirection = z.enum(["tenant_owes", "tenant_credit", "settled"]);

export const SpreadLotRead = z.object({
  unitId: Uuid,
  unitLabel: z.string(),
  amount: Money,
  periodDays: z.number().int().positive(),
  vacancyDays: z.number().int().nonnegative(),
  ownerAmount: Money,
  tenants: z.array(
    z.object({ leaseId: Uuid, leaseReference: z.string(), days: z.number().int(), amount: Money }),
  ),
});
export type SpreadLotRead = z.infer<typeof SpreadLotRead>;

export const RunPostingRead = z.object({
  chargeId: Uuid,
  label: z.string(),
  chargeNature: z.string().nullable(),
  recoverableAmount: Money,
  keyVersionId: Uuid.nullable(),
  keyLabel: z.string().nullable(),
  keyVersionSequence: z.number().int().nullable(),
  lots: z.array(SpreadLotRead),
});
export type RunPostingRead = z.infer<typeof RunPostingRead>;

export const RunLineRead = z.object({
  leaseId: Uuid,
  leaseReference: z.string(),
  tenantName: z.string(),
  unitId: Uuid,
  unitLabel: z.string(),
  occupancyDays: z.number().int().nonnegative(),
  periodDays: z.number().int().positive(),
  recoverableAmount: Money,
  provisionsCalled: Money,
  provisionsPaid: Money,
  provisionsUnpaid: Money,
  balanceAmount: Money,
  totalReceivable: Money,
  direction: RegularizationDirection,
  currency: Currency,
  resultingRentTermId: Uuid.nullable(),
  statementDocumentId: Uuid.nullable(),
});
export type RunLineRead = z.infer<typeof RunLineRead>;

/** CHA-02: a flat fee never produces a regularization; it is listed, not computed. */
export const RunExclusionRead = z.object({
  leaseId: Uuid,
  leaseReference: z.string(),
  reason: z.enum(["flat_fee", "no_charge_regime"]),
  amount: Money,
});
export type RunExclusionRead = z.infer<typeof RunExclusionRead>;

export const RegularizationRunRead = z.object({
  id: Uuid,
  legalEntityId: Uuid,
  legalEntityName: z.string(),
  buildingId: Uuid.nullable(),
  buildingName: z.string().nullable(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  status: RunStatus,
  frozenAt: IsoDateTime.nullable(),
  currency: Currency,
  totalRecoverable: Money,
  totalProvisionsCalled: Money,
  totalOwnerShare: Money,
  netBalance: Money,
  unpaidProvisions: Money,
  postings: z.array(RunPostingRead),
  lines: z.array(RunLineRead),
  excluded: z.array(RunExclusionRead),
  blockedReason: z.string().nullable(),
  missing: z.array(z.string()),
  /** "frozen" means the screen shows what the run stored, never live expenses. */
  source: z.enum(["live", "frozen"]),
  version: Version,
});
export type RegularizationRunRead = z.infer<typeof RegularizationRunRead>;

export const RunSummaryRead = z.object({
  id: Uuid,
  legalEntityName: z.string(),
  buildingName: z.string().nullable(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  status: RunStatus,
  frozenAt: IsoDateTime.nullable(),
  totalRecoverable: Money.nullable(),
  totalProvisionsCalled: Money.nullable(),
  currency: Currency,
});
export type RunSummaryRead = z.infer<typeof RunSummaryRead>;

export const CreateRunInput = z.strictObject({
  legalEntityId: Uuid,
  buildingId: Uuid.optional(),
  periodStart: IsoDate,
  periodEnd: IsoDate,
});
export type CreateRunInput = z.infer<typeof CreateRunInput>;

export const RunActionInput = z.strictObject({ id: Uuid, expectedVersion: Version });
export type RunActionInput = z.infer<typeof RunActionInput>;

export const CloseRunResult = z.object({
  run: RegularizationRunRead,
  commands: z.array(z.object({ leaseId: Uuid, commandId: Uuid, amount: Money })),
  decisionLevel: z.enum(["A", "B", "C", "D"]),
});
export type CloseRunResult = z.infer<typeof CloseRunResult>;

export const StatementInput = z.strictObject({ id: Uuid, leaseId: Uuid });
export type StatementInput = z.infer<typeof StatementInput>;

export const StatementResult = z.object({
  documentId: Uuid,
  jobId: z.string().nullable(),
  run: RegularizationRunRead,
});
export type StatementResult = z.infer<typeof StatementResult>;

const route = (path: string, summary: string) =>
  oc.route({ method: "POST", path: `/charges${path}`, summary });
const read = (path: string, summary: string) =>
  oc.route({ method: "GET", path: `/charges${path}`, summary });

export const chargesContract = {
  charges: {
    keys: {
      list: read("/cles", "Clés de répartition")
        .input(z.strictObject({ legalEntityId: Uuid.optional(), buildingId: Uuid.optional() }))
        .output(z.object({ items: z.array(AllocationKeyRead) })),
      get: read("/cles/{id}", "Clé de répartition")
        .input(z.strictObject({ id: Uuid }))
        .output(AllocationKeyRead),
      create: route("/cles", "Créer une clé de répartition")
        .input(CreateAllocationKeyInput)
        .output(AllocationKeyRead),
      addVersion: route("/cles/versions", "Versionner la clé")
        .input(AddKeyVersionInput)
        .output(AllocationKeyRead),
      updateVersion: route("/cles/versions/modifier", "Modifier une version en brouillon")
        .input(UpdateKeyVersionInput)
        .output(AllocationKeyRead),
      activate: route("/cles/versions/activer", "Activer la version de clé")
        .input(ActivateKeyVersionInput)
        .output(AllocationKeyRead),
      retire: route("/cles/retirer", "Retirer la clé")
        .input(z.strictObject({ id: Uuid, expectedVersion: Version }))
        .output(AllocationKeyRead),
    },
    runs: {
      list: read("/regularisations", "Régularisations de charges")
        .input(z.strictObject({ legalEntityId: Uuid.optional() }))
        .output(z.object({ items: z.array(RunSummaryRead) })),
      get: read("/regularisations/{id}", "Régularisation de charges")
        .input(z.strictObject({ id: Uuid }))
        .output(RegularizationRunRead),
      create: route("/regularisations", "Ouvrir une régularisation")
        .input(CreateRunInput)
        .output(RegularizationRunRead),
      compute: route("/regularisations/calculer", "Calculer la régularisation")
        .input(RunActionInput)
        .output(RegularizationRunRead),
      freeze: route("/regularisations/geler", "Geler dépenses et clés")
        .input(RunActionInput)
        .output(RegularizationRunRead),
      close: route("/regularisations/cloturer", "Préparer les ajustements (validation requise)")
        .input(RunActionInput)
        .output(CloseRunResult),
      statement: route("/regularisations/decompte", "Éditer le décompte individuel")
        .input(StatementInput)
        .output(StatementResult),
      cancel: route("/regularisations/annuler", "Annuler la régularisation")
        .input(RunActionInput)
        .output(RegularizationRunRead),
    },
  },
};
