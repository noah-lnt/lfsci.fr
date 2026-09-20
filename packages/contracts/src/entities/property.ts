import { z } from "zod";
import {
  BuildingStatus,
  UnitEnergyClass,
  UnitKind,
  UnitStatus,
  UnitUsagePeriodUsage,
} from "../enums";
import { Audited, IsoDate, Share, Uuid, Version } from "../primitives";

export const Building = Audited.extend({
  legalEntityId: Uuid,
  code: z.string(),
  name: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  countryCode: z.string().length(2),
  cadastralRef: z.string().nullable(),
  acquiredOn: IsoDate.nullable(),
  soldOn: IsoDate.nullable(),
  status: BuildingStatus,
});
export type Building = z.infer<typeof Building>;

export const CreateBuildingInput = z.strictObject({
  legalEntityId: Uuid,
  code: z.string().min(1),
  name: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  postalCode: z.string().optional(),
  city: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  acquiredOn: IsoDate.optional(),
});
export type CreateBuildingInput = z.infer<typeof CreateBuildingInput>;

export const UpdateBuildingInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  name: z.string().min(1).optional(),
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  cadastralRef: z.string().nullable().optional(),
  soldOn: IsoDate.nullable().optional(),
  status: BuildingStatus.optional(),
});
export type UpdateBuildingInput = z.infer<typeof UpdateBuildingInput>;

export const Unit = Audited.extend({
  buildingId: Uuid,
  code: z.string(),
  label: z.string(),
  kind: UnitKind,
  floor: z.string().nullable(),
  roomCount: z.number().int().nullable(),
  livingAreaSqm: z.string().nullable(),
  ownershipShare: Share.nullable(),
  energyClass: UnitEnergyClass.nullable(),
  energyAuditOn: IsoDate.nullable(),
  energyClassValidUntil: IsoDate.nullable(),
  acquiredOn: IsoDate.nullable(),
  disposedOn: IsoDate.nullable(),
  status: UnitStatus,
});
export type Unit = z.infer<typeof Unit>;

export const CreateUnitInput = z.strictObject({
  buildingId: Uuid,
  code: z.string().min(1),
  label: z.string().min(1),
  kind: UnitKind,
  floor: z.string().optional(),
  roomCount: z.number().int().min(0).optional(),
  livingAreaSqm: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,2})?$/)
    .optional(),
  ownershipShare: Share.optional(),
  energyClass: UnitEnergyClass.optional(),
});
export type CreateUnitInput = z.infer<typeof CreateUnitInput>;

export const UpdateUnitInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  kind: UnitKind.optional(),
  floor: z.string().nullable().optional(),
  roomCount: z.number().int().min(0).nullable().optional(),
  livingAreaSqm: z.string().nullable().optional(),
  energyClass: UnitEnergyClass.nullable().optional(),
  energyAuditOn: IsoDate.nullable().optional(),
  status: UnitStatus.optional(),
});
export type UpdateUnitInput = z.infer<typeof UpdateUnitInput>;

export const UnitUsagePeriod = Audited.extend({
  unitId: Uuid,
  usage: UnitUsagePeriodUsage,
  startsOn: IsoDate,
  endsOn: IsoDate.nullable(),
  note: z.string().nullable(),
});
export type UnitUsagePeriod = z.infer<typeof UnitUsagePeriod>;
