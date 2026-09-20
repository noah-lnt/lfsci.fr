import { z } from "zod";
import {
  BankAccountFeedSource,
  BankAccountPurpose,
  BankAccountStatus,
  LegalEntityEInvoicingChannel,
  LegalEntityIncomeTaxRegime,
  LegalEntityLegalForm,
  LegalEntityStatus,
  LegalEntityVatStatus,
} from "../enums";
import { Audited, Currency, IsoDate, IsoDateTime, Money, Uuid, Version } from "../primitives";

export const LegalEntity = Audited.extend({
  name: z.string(),
  legalForm: LegalEntityLegalForm,
  siren: z.string().nullable(),
  incomeTaxRegime: LegalEntityIncomeTaxRegime,
  vatStatus: LegalEntityVatStatus,
  fiscalQualificationValidatedOn: IsoDate.nullable(),
  eInvoicingChannel: LegalEntityEInvoicingChannel.nullable(),
  fiscalYearEndMonth: z.number().int().min(1).max(12).nullable(),
  fiscalYearEndDay: z.number().int().min(1).max(31).nullable(),
  odooCompanyId: z.number().int().nullable(),
  currency: Currency,
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().length(2),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  status: LegalEntityStatus,
});
export type LegalEntity = z.infer<typeof LegalEntity>;

export const CreateLegalEntityInput = z.strictObject({
  name: z.string().min(1),
  legalForm: LegalEntityLegalForm,
  siren: z
    .string()
    .regex(/^\d{9}$/)
    .optional(),
  incomeTaxRegime: LegalEntityIncomeTaxRegime.optional(),
  vatStatus: LegalEntityVatStatus.optional(),
  fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
  fiscalYearEndDay: z.number().int().min(1).max(31).optional(),
  addressLine1: z.string().min(1).optional(),
  addressLine2: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  country: z.string().length(2).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().min(1).optional(),
});
export type CreateLegalEntityInput = z.infer<typeof CreateLegalEntityInput>;

export const UpdateLegalEntityInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  name: z.string().min(1).optional(),
  siren: z
    .string()
    .regex(/^\d{9}$/)
    .nullable()
    .optional(),
  incomeTaxRegime: LegalEntityIncomeTaxRegime.optional(),
  vatStatus: LegalEntityVatStatus.optional(),
  eInvoicingChannel: LegalEntityEInvoicingChannel.optional(),
  addressLine1: z.string().min(1).nullable().optional(),
  addressLine2: z.string().min(1).nullable().optional(),
  postalCode: z.string().min(1).nullable().optional(),
  city: z.string().min(1).nullable().optional(),
  country: z.string().length(2).optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: z.string().min(1).nullable().optional(),
  status: LegalEntityStatus.optional(),
});
export type UpdateLegalEntityInput = z.infer<typeof UpdateLegalEntityInput>;

export const BankAccount = Audited.extend({
  legalEntityId: Uuid,
  label: z.string(),
  bankName: z.string().nullable(),
  ibanLast4: z.string().length(4).nullable(),
  bic: z.string().nullable(),
  purpose: BankAccountPurpose,
  currency: Currency,
  openingBalance: Money,
  openingBalanceOn: IsoDate.nullable(),
  feedSource: BankAccountFeedSource.nullable(),
  feedLastSuccessAt: IsoDateTime.nullable(),
  odooBalance: Money.nullable(),
  odooBalanceOn: IsoDate.nullable(),
  odooReadAt: IsoDateTime.nullable(),
  status: BankAccountStatus,
});
export type BankAccount = z.infer<typeof BankAccount>;
