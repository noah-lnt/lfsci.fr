import { z } from "zod";
import {
  ExpenseAllocationTarget,
  ExpenseDocumentKind,
  ExpensePayer,
  ExpenseStatus,
  SupplierStatus,
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

export const Supplier = Audited.extend({
  name: z.string(),
  trade: z.string().nullable(),
  siren: z.string().nullable(),
  personId: Uuid.nullable(),
  paymentIbanLast4: z.string().length(4).nullable(),
  paymentIdentityValidatedAt: IsoDateTime.nullable(),
  status: SupplierStatus,
});
export type Supplier = z.infer<typeof Supplier>;

export const ExpenseAllocation = Audited.extend({
  expenseLineId: Uuid,
  target: ExpenseAllocationTarget,
  unitId: Uuid.nullable(),
  buildingId: Uuid.nullable(),
  legalEntityId: Uuid.nullable(),
  amount: Money,
  currency: Currency,
  recoverableAmount: Money,
  keyVersionId: Uuid.nullable(),
  ruleVersionId: Uuid.nullable(),
  aiExtractionId: Uuid.nullable(),
});
export type ExpenseAllocation = z.infer<typeof ExpenseAllocation>;

export const ExpenseLine = Audited.extend({
  expenseId: Uuid,
  lineNumber: z.number().int().positive(),
  description: z.string(),
  quantity: z.string().nullable(),
  amountExclTax: Money.nullable(),
  taxAmount: Money.nullable(),
  amountInclTax: Money,
  currency: Currency,
  chargeNature: z.string().nullable(),
  recoverableShare: Share,
  servicePeriodStart: IsoDate.nullable(),
  servicePeriodEnd: IsoDate.nullable(),
  unallocatedAmount: Money,
  allocations: z.array(ExpenseAllocation),
});
export type ExpenseLine = z.infer<typeof ExpenseLine>;

export const Expense = Audited.extend({
  legalEntityId: Uuid,
  supplierId: Uuid.nullable(),
  worksProjectId: Uuid.nullable(),
  interventionId: Uuid.nullable(),
  documentKind: ExpenseDocumentKind,
  supplierReference: z.string().nullable(),
  issuedOn: IsoDate.nullable(),
  totalExclTax: Money.nullable(),
  taxAmount: Money.nullable(),
  totalInclTax: Money,
  currency: Currency,
  payer: ExpensePayer,
  paidByPersonId: Uuid.nullable(),
  duplicateOfExpenseId: Uuid.nullable(),
  creditNoteOfExpenseId: Uuid.nullable(),
  status: ExpenseStatus,
  odooMoveName: z.string().nullable(),
  odooReadAt: IsoDateTime.nullable(),
  lines: z.array(ExpenseLine),
});
export type Expense = z.infer<typeof Expense>;

export const CaptureExpenseInput = z.strictObject({
  legalEntityId: Uuid,
  documentKind: ExpenseDocumentKind,
  totalInclTax: Money,
  totalExclTax: Money.optional(),
  taxAmount: Money.optional(),
  issuedOn: IsoDate.optional(),
  supplierId: Uuid.optional(),
  supplierName: z.string().min(1).optional(),
  supplierReference: z.string().optional(),
  worksProjectId: Uuid.optional(),
  interventionId: Uuid.optional(),
  payer: ExpensePayer.optional(),
  paidByPersonId: Uuid.optional(),
  documentId: Uuid.optional(),
  inboxItemId: Uuid.optional(),
});
export type CaptureExpenseInput = z.infer<typeof CaptureExpenseInput>;

export const UpdateExpenseInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  supplierId: Uuid.nullable().optional(),
  issuedOn: IsoDate.nullable().optional(),
  totalExclTax: Money.nullable().optional(),
  taxAmount: Money.nullable().optional(),
  totalInclTax: Money.optional(),
  payer: ExpensePayer.optional(),
  paidByPersonId: Uuid.nullable().optional(),
  status: ExpenseStatus.optional(),
});
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseInput>;
