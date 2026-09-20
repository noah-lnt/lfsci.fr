import { z } from "zod";
import { Audited, Currency, IsoDate, IsoDateTime, Money, Uuid, Version } from "../primitives";

const Duration = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "durée en années attendue");

/** IMM-01: an asset is a sum of components, each with its own life. */
export const AssetComponent = Audited.extend({
  fixedAssetId: Uuid,
  label: z.string(),
  grossValue: Money,
  currency: Currency,
  durationYears: Duration.nullable(),
  commissionedOn: IsoDate.nullable(),
  replacedComponentId: Uuid.nullable(),
  isDepreciable: z.boolean(),
  equipmentId: Uuid.nullable(),
  odooReadAt: IsoDateTime.nullable(),
});
export type AssetComponent = z.infer<typeof AssetComponent>;

export const CreateFixedAssetInput = z.strictObject({
  legalEntityId: Uuid,
  label: z.string().min(1),
  grossValue: Money,
  /** IMM-02: entered per asset, never a proportion applied to the portfolio. */
  landValue: Money,
  buildingId: Uuid.optional(),
  unitId: Uuid.optional(),
  commissionedOn: IsoDate.optional(),
  durationYears: Duration.optional(),
  method: z.enum(["linear", "degressive", "components", "none"]).optional(),
});
export type CreateFixedAssetInput = z.infer<typeof CreateFixedAssetInput>;

export const UpdateFixedAssetInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  grossValue: Money.optional(),
  landValue: Money.optional(),
  commissionedOn: IsoDate.nullable().optional(),
  durationYears: Duration.nullable().optional(),
  method: z.enum(["linear", "degressive", "components", "none"]).nullable().optional(),
  status: z.enum(["draft", "running", "fully_depreciated", "disposed", "cancelled"]).optional(),
});
export type UpdateFixedAssetInput = z.infer<typeof UpdateFixedAssetInput>;

export const DisposeFixedAssetInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  disposedOn: IsoDate,
  reason: z.string().min(1),
});
export type DisposeFixedAssetInput = z.infer<typeof DisposeFixedAssetInput>;

export const CreateAssetComponentInput = z.strictObject({
  fixedAssetId: Uuid,
  label: z.string().min(1),
  grossValue: Money,
  durationYears: Duration.optional(),
  commissionedOn: IsoDate.optional(),
  isDepreciable: z.boolean().optional(),
  equipmentId: Uuid.optional(),
  replacedComponentId: Uuid.optional(),
});
export type CreateAssetComponentInput = z.infer<typeof CreateAssetComponentInput>;

export const UpdateAssetComponentInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  grossValue: Money.optional(),
  durationYears: Duration.nullable().optional(),
  commissionedOn: IsoDate.nullable().optional(),
  isDepreciable: z.boolean().optional(),
});
export type UpdateAssetComponentInput = z.infer<typeof UpdateAssetComponentInput>;
