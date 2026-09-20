import { z } from "zod";
import {
  CcaMovementKind,
  CcaMovementStatus,
  FixedAssetMethod,
  FixedAssetStatus,
  LoanInstallmentStatus,
  LoanInsuranceBasis,
  LoanRateKind,
  LoanStatus,
  PartnerCurrentAccountStatus,
} from "../enums";
import { Audited, Currency, IsoDate, IsoDateTime, Money, Uuid, Version } from "../primitives";

const Rate = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "taux décimal attendu");

export const LoanInstallment = Audited.extend({
  scheduleVersionId: Uuid,
  installmentNumber: z.number().int().positive(),
  dueOn: IsoDate,
  principalAmount: Money,
  interestAmount: Money,
  insuranceAmount: Money,
  feesAmount: Money,
  totalAmount: Money,
  remainingPrincipal: Money.nullable(),
  currency: Currency,
  bankTransactionId: Uuid.nullable(),
  matchedAt: IsoDateTime.nullable(),
  varianceReason: z.string().nullable(),
  status: LoanInstallmentStatus,
});
export type LoanInstallment = z.infer<typeof LoanInstallment>;

export const Loan = Audited.extend({
  legalEntityId: Uuid,
  lenderName: z.string(),
  reference: z.string(),
  principalAmount: Money,
  currency: Currency,
  releasedOn: IsoDate.nullable(),
  durationMonths: z.number().int().nullable(),
  rateKind: LoanRateKind,
  nominalRate: Rate.nullable(),
  insuranceRate: Rate.nullable(),
  deferralMonths: z.number().int().nullable(),
  upfrontFees: Money.nullable(),
  bankAccountId: Uuid.nullable(),
  odooOutstandingPrincipal: Money.nullable(),
  odooReadAt: IsoDateTime.nullable(),
  insuranceBasis: LoanInsuranceBasis,
  status: LoanStatus,
});
export type Loan = z.infer<typeof Loan>;

export const CreateLoanInput = z.strictObject({
  legalEntityId: Uuid,
  lenderName: z.string().min(1),
  reference: z.string().min(1),
  principalAmount: Money,
  releasedOn: IsoDate.optional(),
  durationMonths: z.number().int().positive().optional(),
  rateKind: LoanRateKind.optional(),
  nominalRate: Rate.optional(),
  insuranceRate: Rate.optional(),
  deferralMonths: z.number().int().min(0).optional(),
  upfrontFees: Money.optional(),
  bankAccountId: Uuid.optional(),
});
export type CreateLoanInput = z.infer<typeof CreateLoanInput>;

export const UpdateLoanInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  lenderName: z.string().min(1).optional(),
  nominalRate: Rate.nullable().optional(),
  insuranceRate: Rate.nullable().optional(),
  bankAccountId: Uuid.nullable().optional(),
  status: LoanStatus.optional(),
});
export type UpdateLoanInput = z.infer<typeof UpdateLoanInput>;

export const CcaMovement = Audited.extend({
  ccaId: Uuid,
  kind: CcaMovementKind,
  amount: Money,
  currency: Currency,
  occurredOn: IsoDate,
  expenseId: Uuid.nullable(),
  paymentId: Uuid.nullable(),
  bankTransactionId: Uuid.nullable(),
  approvalId: Uuid.nullable(),
  status: CcaMovementStatus,
  odooReadAt: IsoDateTime.nullable(),
});
export type CcaMovement = z.infer<typeof CcaMovement>;

export const CreateCcaMovementInput = z.strictObject({
  ccaId: Uuid,
  kind: CcaMovementKind,
  amount: Money,
  occurredOn: IsoDate,
  expenseId: Uuid.optional(),
  paymentId: Uuid.optional(),
  justification: z.string().min(1),
});
export type CreateCcaMovementInput = z.infer<typeof CreateCcaMovementInput>;

export const PartnerCurrentAccount = Audited.extend({
  legalEntityId: Uuid,
  partnerPersonId: Uuid,
  agreementDocumentId: Uuid.nullable(),
  interestRate: Rate.nullable(),
  conditions: z.string().nullable(),
  currency: Currency,
  odooBalance: Money.nullable(),
  odooReadAt: IsoDateTime.nullable(),
  projectedBalance: Money,
  status: PartnerCurrentAccountStatus,
});
export type PartnerCurrentAccount = z.infer<typeof PartnerCurrentAccount>;

export const FixedAsset = Audited.extend({
  legalEntityId: Uuid,
  buildingId: Uuid.nullable(),
  unitId: Uuid.nullable(),
  label: z.string(),
  grossValue: Money,
  landValue: Money,
  currency: Currency,
  commissionedOn: IsoDate.nullable(),
  durationYears: Rate.nullable(),
  method: FixedAssetMethod.nullable(),
  accumulatedDepreciation: Money,
  netBookValue: Money.nullable(),
  disposedOn: IsoDate.nullable(),
  odooReadAt: IsoDateTime.nullable(),
  status: FixedAssetStatus,
});
export type FixedAsset = z.infer<typeof FixedAsset>;
