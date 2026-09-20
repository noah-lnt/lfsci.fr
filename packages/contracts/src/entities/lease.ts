import { z } from "zod";
import {
  LeaseChargeRegime,
  LeaseKind,
  LeasePartyRole,
  LeaseProrationRule,
  LeaseRevisionIndex,
  LeaseStatus,
  LeaseTermPeriodicity,
  LeaseUnitRole,
  RentTermKind,
  RentTermStatus,
  RentTermVersionReason,
} from "../enums";
import {
  Audited,
  Currency,
  IsoDate,
  IsoDateTime,
  Money,
  Share,
  Uuid,
  Version,
} from "../primitives";

export const LeaseParty = Audited.extend({
  leaseId: Uuid,
  personId: Uuid,
  role: LeasePartyRole,
  startsOn: IsoDate,
  endsOn: IsoDate.nullable(),
  isBillingContact: z.boolean(),
});
export type LeaseParty = z.infer<typeof LeaseParty>;

export const LeaseUnit = Audited.extend({
  leaseId: Uuid,
  unitId: Uuid,
  role: LeaseUnitRole,
  startsOn: IsoDate,
  endsOn: IsoDate.nullable(),
});
export type LeaseUnit = z.infer<typeof LeaseUnit>;

export const Lease = Audited.extend({
  legalEntityId: Uuid,
  reference: z.string(),
  kind: LeaseKind,
  status: LeaseStatus,
  signedOn: IsoDate.nullable(),
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
  durationMonths: z.number().int().nullable(),
  rentExclCharges: Money.nullable(),
  chargeRegime: LeaseChargeRegime,
  chargeAmount: Money.nullable(),
  currency: Currency,
  depositAmount: Money.nullable(),
  paymentDay: z.number().int().min(1).max(31).nullable(),
  paymentInAdvance: z.boolean(),
  termPeriodicity: LeaseTermPeriodicity,
  prorationRule: LeaseProrationRule.nullable(),
  revisionIndex: LeaseRevisionIndex.nullable(),
  revisionReferenceQuarter: z.string().nullable(),
  revisionMonth: z.number().int().min(1).max(12).nullable(),
  solidarity: z.boolean(),
  noticeReceivedOn: IsoDate.nullable(),
  noticeAnnouncedEndOn: IsoDate.nullable(),
  noticeLegallyEstablished: z.boolean(),
  keysReturnedOn: IsoDate.nullable(),
  parties: z.array(LeaseParty),
  units: z.array(LeaseUnit),
});
export type Lease = z.infer<typeof Lease>;

export const CreateLeaseInput = z.strictObject({
  legalEntityId: Uuid,
  reference: z.string().min(1),
  kind: LeaseKind,
  startsOn: IsoDate,
  endsOn: IsoDate.optional(),
  durationMonths: z.number().int().positive().optional(),
  rentExclCharges: Money,
  chargeRegime: LeaseChargeRegime,
  chargeAmount: Money.optional(),
  depositAmount: Money.optional(),
  paymentDay: z.number().int().min(1).max(31),
  paymentInAdvance: z.boolean().optional(),
  termPeriodicity: LeaseTermPeriodicity.optional(),
  prorationRule: LeaseProrationRule.optional(),
  revisionIndex: LeaseRevisionIndex.optional(),
  revisionReferenceQuarter: z.string().optional(),
  revisionMonth: z.number().int().min(1).max(12).optional(),
  solidarity: z.boolean().optional(),
  parties: z
    .array(
      z.strictObject({
        personId: Uuid,
        role: LeasePartyRole,
        startsOn: IsoDate,
        isBillingContact: z.boolean().optional(),
      }),
    )
    .min(1),
  units: z.array(z.strictObject({ unitId: Uuid, role: LeaseUnitRole, startsOn: IsoDate })).min(1),
});
export type CreateLeaseInput = z.infer<typeof CreateLeaseInput>;

export const UpdateLeaseInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  status: LeaseStatus.optional(),
  signedOn: IsoDate.nullable().optional(),
  endsOn: IsoDate.nullable().optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
  noticeReceivedOn: IsoDate.nullable().optional(),
  noticeAnnouncedEndOn: IsoDate.nullable().optional(),
  noticeLegallyEstablished: z.boolean().optional(),
  keysReturnedOn: IsoDate.nullable().optional(),
});
export type UpdateLeaseInput = z.infer<typeof UpdateLeaseInput>;

export const RentTermVersion = Audited.extend({
  rentTermId: Uuid,
  sequence: z.number().int().positive(),
  rentAmount: Money,
  chargeAmount: Money,
  accessoryAmount: Money,
  totalAmount: Money,
  currency: Currency,
  prorationFactor: Share.nullable(),
  ruleVersionId: Uuid.nullable(),
  reason: RentTermVersionReason,
  isPosted: z.boolean(),
  odooMoveName: z.string().nullable(),
  odooReadAt: IsoDateTime.nullable(),
});
export type RentTermVersion = z.infer<typeof RentTermVersion>;

export const RentTerm = Audited.extend({
  leaseId: Uuid,
  kind: RentTermKind,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  dueOn: IsoDate,
  status: RentTermStatus,
  currentVersion: RentTermVersion.nullable(),
  postedAt: IsoDateTime.nullable(),
  settledAt: IsoDateTime.nullable(),
  adjustsRentTermId: Uuid.nullable(),
});
export type RentTerm = z.infer<typeof RentTerm>;
