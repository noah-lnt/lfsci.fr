import { z } from "zod";
import {
  EquipmentStatus,
  InterventionPerformedBy,
  InterventionStatus,
  InterventionUrgency,
  WorksProjectAccountingTreatment,
  WorksProjectNature,
  WorksProjectStatus,
} from "../enums";
import { Audited, Currency, IsoDate, Money, Uuid, Version } from "../primitives";

export const WorksProject = Audited.extend({
  legalEntityId: Uuid,
  buildingId: Uuid.nullable(),
  unitId: Uuid.nullable(),
  label: z.string(),
  nature: WorksProjectNature,
  accountingTreatment: WorksProjectAccountingTreatment,
  budgetAmount: Money.nullable(),
  currency: Currency,
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
  status: WorksProjectStatus,
});
export type WorksProject = z.infer<typeof WorksProject>;

export const Intervention = Audited.extend({
  worksProjectId: Uuid.nullable(),
  buildingId: Uuid.nullable(),
  unitId: Uuid.nullable(),
  equipmentId: Uuid.nullable(),
  leaseId: Uuid.nullable(),
  claimId: Uuid.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  urgency: InterventionUrgency,
  status: InterventionStatus,
  performedBy: InterventionPerformedBy,
  supplierId: Uuid.nullable(),
  reportedOn: IsoDate.nullable(),
  scheduledOn: IsoDate.nullable(),
  completedOn: IsoDate.nullable(),
  ownerHours: z.string().nullable(),
  observedResult: z.string().nullable(),
  nextCheckOn: IsoDate.nullable(),
});
export type Intervention = z.infer<typeof Intervention>;

export const CreateInterventionInput = z.strictObject({
  title: z.string().min(1),
  description: z.string().optional(),
  urgency: InterventionUrgency.optional(),
  performedBy: InterventionPerformedBy.optional(),
  worksProjectId: Uuid.optional(),
  buildingId: Uuid.optional(),
  unitId: Uuid.optional(),
  equipmentId: Uuid.optional(),
  leaseId: Uuid.optional(),
  supplierId: Uuid.optional(),
  reportedOn: IsoDate.optional(),
  scheduledOn: IsoDate.optional(),
});
export type CreateInterventionInput = z.infer<typeof CreateInterventionInput>;

export const UpdateInterventionInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  urgency: InterventionUrgency.optional(),
  status: InterventionStatus.optional(),
  supplierId: Uuid.nullable().optional(),
  scheduledOn: IsoDate.nullable().optional(),
  completedOn: IsoDate.nullable().optional(),
  ownerHours: z
    .string()
    .regex(/^\d{1,7}(\.\d{1,2})?$/)
    .nullable()
    .optional(),
  observedResult: z.string().nullable().optional(),
  nextCheckOn: IsoDate.nullable().optional(),
});
export type UpdateInterventionInput = z.infer<typeof UpdateInterventionInput>;

export const Equipment = Audited.extend({
  category: z.string(),
  label: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  qrCode: z.string().nullable(),
  purchasedOn: IsoDate.nullable(),
  commissionedOn: IsoDate.nullable(),
  documentedCost: Money.nullable(),
  currency: Currency,
  warrantyUntil: IsoDate.nullable(),
  supplierId: Uuid.nullable(),
  fixedAssetId: Uuid.nullable(),
  status: EquipmentStatus,
});
export type Equipment = z.infer<typeof Equipment>;
