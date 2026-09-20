import { z } from "zod";
import {
  InspectionFindingCondition,
  InspectionKind,
  InspectionStatus,
  InventoryItemCondition,
} from "../enums";
import { Audited, Currency, IsoDate, Money, Share, Uuid } from "../primitives";

/** `inventory_item.quantity` is numeric(9,3): a count, never money. */
export const Quantity = z
  .string()
  .regex(/^\d{1,6}(\.\d{1,3})?$/, "quantité décimale attendue, 3 décimales maximum");
export type Quantity = z.infer<typeof Quantity>;

export const Inspection = Audited.extend({
  leaseId: Uuid,
  unitId: Uuid,
  kind: InspectionKind,
  performedOn: IsoDate.nullable(),
  status: InspectionStatus,
  signedDocumentId: Uuid.nullable(),
  signatureEvidence: z.string().nullable(),
  keysHandedOverOn: IsoDate.nullable(),
  complementDeadlineOn: IsoDate.nullable(),
  heatingComplementDeadlineOn: IsoDate.nullable(),
  offlineCapture: z.boolean(),
});
export type Inspection = z.infer<typeof Inspection>;

/**
 * EDL-03: a finding is an observation. `decidedAmount` only exists once the
 * owner has decided, and no rule here turns a condition into an amount.
 */
export const InspectionFinding = Audited.extend({
  inspectionId: Uuid,
  room: z.string().nullable(),
  element: z.string(),
  equipmentId: Uuid.nullable(),
  condition: InspectionFindingCondition.nullable(),
  description: z.string().nullable(),
  entryFindingId: Uuid.nullable(),
  isNewVersusEntry: z.boolean().nullable(),
  proposedWearShare: Share.nullable(),
  decidedAmount: Money.nullable(),
  currency: Currency,
  decisionApprovalId: Uuid.nullable(),
});
export type InspectionFinding = z.infer<typeof InspectionFinding>;

export const InventoryItem = Audited.extend({
  unitId: Uuid,
  leaseId: Uuid.nullable(),
  category: z.string(),
  label: z.string(),
  quantity: Quantity,
  condition: InventoryItemCondition.nullable(),
  purchaseValue: Money.nullable(),
  currency: Currency,
  equipmentId: Uuid.nullable(),
  presentAtEntry: z.boolean().nullable(),
  presentAtExit: z.boolean().nullable(),
});
export type InventoryItem = z.infer<typeof InventoryItem>;
