import {
  DocumentLinkRelation,
  Inspection,
  InspectionFinding,
  InspectionFindingCondition,
  InspectionKind,
  InspectionStatus,
  InventoryItem,
  InventoryItemCondition,
  IsoDate,
  IsoDateTime,
  LeaseKind,
  listInput,
  Money,
  paginated,
  Quantity,
  Share,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

const route = (path: string, summary: string, method: "GET" | "POST" = "POST") =>
  oc.route({ method, path: `/etats-des-lieux${path}`, summary });

/**
 * EDL-01: a photo carries its author, its capture instant and its reception
 * instant; when the capture metadata is absent the row says so instead of
 * guessing a date.
 */
export const InspectionPhoto = z.object({
  documentId: Uuid,
  title: z.string(),
  authorName: z.string().nullable(),
  capturedAt: IsoDateTime.nullable(),
  receivedAt: IsoDateTime,
  metadataMissing: z.boolean(),
  sha256: z.string(),
  relations: z.array(DocumentLinkRelation),
});
export type InspectionPhoto = z.infer<typeof InspectionPhoto>;

export const InspectionRow = Inspection.extend({
  unitLabel: z.string(),
  findingCount: z.number().int().min(0),
  photoCount: z.number().int().min(0),
});
export type InspectionRow = z.infer<typeof InspectionRow>;

export const InspectionDetail = Inspection.extend({
  unitLabel: z.string(),
  leaseReference: z.string(),
  findings: z.array(InspectionFinding),
  photos: z.array(InspectionPhoto),
});
export type InspectionDetail = z.infer<typeof InspectionDetail>;

export const DifferenceStatus = z.enum([
  "new",
  "degraded",
  "unchanged",
  "improved",
  "not_observed",
  "undetermined",
]);
export type DifferenceStatus = z.infer<typeof DifferenceStatus>;

export const FindingDifference = z.object({
  room: z.string().nullable(),
  element: z.string(),
  entryFindingId: Uuid.nullable(),
  entryCondition: InspectionFindingCondition.nullable(),
  exitFindingId: Uuid.nullable(),
  exitCondition: InspectionFindingCondition.nullable(),
  description: z.string().nullable(),
  status: DifferenceStatus,
  proposedForReview: z.boolean(),
});
export type FindingDifference = z.infer<typeof FindingDifference>;

export const InventoryDifferenceStatus = z.enum([
  "present",
  "missing",
  "added",
  "absent",
  "undetermined",
]);
export type InventoryDifferenceStatus = z.infer<typeof InventoryDifferenceStatus>;

export const InventoryDifference = z.object({
  id: Uuid,
  label: z.string(),
  category: z.string(),
  quantity: Quantity,
  condition: InventoryItemCondition.nullable(),
  presentAtEntry: z.boolean().nullable(),
  presentAtExit: z.boolean().nullable(),
  status: InventoryDifferenceStatus,
  requiresDecision: z.boolean(),
});
export type InventoryDifference = z.infer<typeof InventoryDifference>;

export const ComparisonRead = z.object({
  leaseId: Uuid,
  entryInspectionId: Uuid.nullable(),
  exitInspectionId: Uuid.nullable(),
  differences: z.array(FindingDifference),
  inventory: z.array(InventoryDifference),
  proposedCount: z.number().int().min(0),
  exitConforms: z.boolean(),
});
export type ComparisonRead = z.infer<typeof ComparisonRead>;

export const SettlementBlockedReason = z.enum([
  "keys_not_handed_over",
  "deduction_without_justification",
  "deductions_exceed_deposit",
  "negative_deduction",
]);
export type SettlementBlockedReason = z.infer<typeof SettlementBlockedReason>;

export const SettlementDeduction = z.object({
  findingId: Uuid,
  label: z.string(),
  amount: Money,
  justificationCount: z.number().int().min(0),
});
export type SettlementDeduction = z.infer<typeof SettlementDeduction>;

/**
 * EDL-03: the restitution deadline comes from `settleDeposit` and the key
 * handover. `missingInventory` is reported next to it and stays out of the
 * deductions: only an amount the owner decided is withheld (EDL-02).
 */
export const DepositSettlementRead = z.object({
  leaseId: Uuid,
  leaseKind: LeaseKind,
  exitInspectionId: Uuid.nullable(),
  contractualDeposit: Money.nullable(),
  depositHeld: Money,
  keyHandoverDate: IsoDate.nullable(),
  exitConforms: z.boolean(),
  deductions: z.array(SettlementDeduction),
  missingInventory: z.array(z.object({ id: Uuid, label: z.string() })),
  totalDeductions: Money.nullable(),
  restitution: Money.nullable(),
  deadline: IsoDate.nullable(),
  deadlineMonths: z.union([z.literal(1), z.literal(2)]).nullable(),
  blockedReason: SettlementBlockedReason.nullable(),
  blockedFindingIds: z.array(Uuid),
});
export type DepositSettlementRead = z.infer<typeof DepositSettlementRead>;

export const CreateInspectionInput = z.strictObject({
  leaseId: Uuid,
  unitId: Uuid,
  kind: InspectionKind,
  performedOn: IsoDate.optional(),
  offlineCapture: z.boolean().optional(),
});
export type CreateInspectionInput = z.infer<typeof CreateInspectionInput>;

export const UpdateInspectionInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  performedOn: IsoDate.nullable().optional(),
  status: InspectionStatus.optional(),
  keysHandedOverOn: IsoDate.nullable().optional(),
  heatingComplementDeadlineOn: IsoDate.nullable().optional(),
  signedDocumentId: Uuid.nullable().optional(),
  signatureEvidence: z.string().min(1).nullable().optional(),
});
export type UpdateInspectionInput = z.infer<typeof UpdateInspectionInput>;

export const AddFindingInput = z.strictObject({
  inspectionId: Uuid,
  room: z.string().min(1).optional(),
  element: z.string().min(1),
  condition: InspectionFindingCondition.optional(),
  description: z.string().min(1).optional(),
  equipmentId: Uuid.optional(),
});
export type AddFindingInput = z.infer<typeof AddFindingInput>;

export const UpdateFindingInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  room: z.string().min(1).nullable().optional(),
  element: z.string().min(1).optional(),
  condition: InspectionFindingCondition.nullable().optional(),
  description: z.string().min(1).nullable().optional(),
  proposedWearShare: Share.nullable().optional(),
  decidedAmount: Money.nullable().optional(),
});
export type UpdateFindingInput = z.infer<typeof UpdateFindingInput>;

export const AddInventoryItemInput = z.strictObject({
  leaseId: Uuid,
  unitId: Uuid,
  category: z.string().min(1),
  label: z.string().min(1),
  quantity: Quantity.optional(),
  condition: InventoryItemCondition.optional(),
  purchaseValue: Money.optional(),
  equipmentId: Uuid.optional(),
  presentAtEntry: z.boolean().optional(),
  presentAtExit: z.boolean().optional(),
});
export type AddInventoryItemInput = z.infer<typeof AddInventoryItemInput>;

export const UpdateInventoryItemInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  category: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  quantity: Quantity.optional(),
  condition: InventoryItemCondition.nullable().optional(),
  purchaseValue: Money.nullable().optional(),
  presentAtEntry: z.boolean().nullable().optional(),
  presentAtExit: z.boolean().nullable().optional(),
});
export type UpdateInventoryItemInput = z.infer<typeof UpdateInventoryItemInput>;

const Removed = z.object({ id: Uuid });

export const inspectionsContract = {
  inspections: {
    list: route("/liste", "États des lieux d’un bail", "GET")
      .input(listInput({ leaseId: Uuid, kind: InspectionKind.optional() }))
      .output(paginated(InspectionRow)),
    get: route("/fiche", "Un état des lieux", "GET")
      .input(z.strictObject({ id: Uuid }))
      .output(InspectionDetail),
    create: route("/creer", "Ouvrir un état des lieux")
      .input(CreateInspectionInput)
      .output(Inspection),
    update: route("/modifier", "Modifier l’état des lieux")
      .input(UpdateInspectionInput)
      .output(Inspection),
    remove: route("/supprimer", "Supprimer un état des lieux non signé")
      .input(z.strictObject({ id: Uuid, expectedVersion: Version }))
      .output(Removed),
    findings: {
      add: route("/constats/ajouter", "Ajouter un constat")
        .input(AddFindingInput)
        .output(InspectionFinding),
      update: route("/constats/modifier", "Modifier un constat")
        .input(UpdateFindingInput)
        .output(InspectionFinding),
      remove: route("/constats/supprimer", "Supprimer un constat")
        .input(z.strictObject({ id: Uuid, expectedVersion: Version }))
        .output(Removed),
    },
    inventory: {
      list: route("/inventaire", "Inventaire du meublé", "GET")
        .input(listInput({ leaseId: Uuid }))
        .output(paginated(InventoryItem)),
      add: route("/inventaire/ajouter", "Ajouter une ligne d’inventaire")
        .input(AddInventoryItemInput)
        .output(InventoryItem),
      update: route("/inventaire/modifier", "Modifier une ligne d’inventaire")
        .input(UpdateInventoryItemInput)
        .output(InventoryItem),
      remove: route("/inventaire/supprimer", "Supprimer une ligne d’inventaire")
        .input(z.strictObject({ id: Uuid, expectedVersion: Version }))
        .output(Removed),
    },
    comparison: route("/comparaison", "Écarts entrée / sortie", "GET")
      .input(z.strictObject({ leaseId: Uuid }))
      .output(ComparisonRead),
    settlement: route("/restitution", "Préparation de la restitution du dépôt", "GET")
      .input(z.strictObject({ leaseId: Uuid }))
      .output(DepositSettlementRead),
  },
};
