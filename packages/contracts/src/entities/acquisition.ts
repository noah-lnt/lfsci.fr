import { z } from "zod";
import { AcquisitionOpportunityStatus } from "../enums";
import { Audited, Currency, IsoDate, Money, Share, Uuid, Version } from "../primitives";

/** ACQ-01: the assumptions are kept next to the figures they produced. */
export const AcquisitionScenario = Audited.extend({
  opportunityId: Uuid,
  label: z.string(),
  isBase: z.boolean(),
  assumptions: z.record(z.string(), z.unknown()),
  loanAmount: Money.nullable(),
  equityAmount: Money.nullable(),
  vacancyRate: Share.nullable(),
  unpaidRate: Share.nullable(),
  currency: Currency,
});
export type AcquisitionScenario = z.infer<typeof AcquisitionScenario>;

export const AcquisitionOpportunity = Audited.extend({
  legalEntityId: Uuid.nullable(),
  label: z.string(),
  addressLine1: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  askingPrice: Money.nullable(),
  estimatedFees: Money.nullable(),
  estimatedWorks: Money.nullable(),
  expectedRentYearly: Money.nullable(),
  currency: Currency,
  status: AcquisitionOpportunityStatus,
  signedOn: IsoDate.nullable(),
  convertedBuildingId: Uuid.nullable(),
  conversionCommandId: Uuid.nullable(),
});
export type AcquisitionOpportunity = z.infer<typeof AcquisitionOpportunity>;

export const CreateAcquisitionOpportunityInput = z.strictObject({
  label: z.string().min(1),
  legalEntityId: Uuid.optional(),
  addressLine1: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  askingPrice: Money.optional(),
  estimatedFees: Money.optional(),
  estimatedWorks: Money.optional(),
  expectedRentYearly: Money.optional(),
  status: AcquisitionOpportunityStatus.optional(),
  signedOn: IsoDate.optional(),
});
export type CreateAcquisitionOpportunityInput = z.infer<typeof CreateAcquisitionOpportunityInput>;

export const UpdateAcquisitionOpportunityInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  legalEntityId: Uuid.nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  askingPrice: Money.nullable().optional(),
  estimatedFees: Money.nullable().optional(),
  estimatedWorks: Money.nullable().optional(),
  expectedRentYearly: Money.nullable().optional(),
  status: AcquisitionOpportunityStatus.optional(),
  signedOn: IsoDate.nullable().optional(),
});
export type UpdateAcquisitionOpportunityInput = z.infer<typeof UpdateAcquisitionOpportunityInput>;

export const CreateAcquisitionScenarioInput = z.strictObject({
  opportunityId: Uuid,
  label: z.string().min(1),
  isBase: z.boolean().optional(),
  loanAmount: Money.optional(),
  equityAmount: Money.optional(),
  vacancyRate: Share.optional(),
  unpaidRate: Share.optional(),
  chargesYearly: Money.optional(),
  loanRate: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,6})?$/)
    .optional(),
  loanMonths: z.number().int().positive().optional(),
  lender: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type CreateAcquisitionScenarioInput = z.infer<typeof CreateAcquisitionScenarioInput>;

export const UpdateAcquisitionScenarioInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  isBase: z.boolean().optional(),
  loanAmount: Money.nullable().optional(),
  equityAmount: Money.nullable().optional(),
  vacancyRate: Share.nullable().optional(),
  unpaidRate: Share.nullable().optional(),
  chargesYearly: Money.optional(),
  loanRate: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,6})?$/)
    .optional(),
  loanMonths: z.number().int().positive().optional(),
  lender: z.string().min(1).optional(),
  notes: z.string().optional(),
});
export type UpdateAcquisitionScenarioInput = z.infer<typeof UpdateAcquisitionScenarioInput>;
