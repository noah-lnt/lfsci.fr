import { z } from "zod";
import {
  byId,
  CaptureExpenseInput,
  CcaMovement,
  CreateCcaMovementInput,
  CreateLoanInput,
  Expense,
  FixedAsset,
  Loan,
  LoanInstallment,
  listInput,
  PartnerCurrentAccount,
  paginated,
  UpdateExpenseInput,
  UpdateLoanInput,
} from "../entities";
import { CcaMovementStatus, ExpenseStatus, FixedAssetStatus, LoanStatus } from "../enums";
import { Currency, IsoDate, IsoDateTime, Money, Uuid, Version } from "../primitives";

export const captureExpense = { input: CaptureExpenseInput, output: Expense };
export const updateExpense = { input: UpdateExpenseInput, output: Expense };
export const getExpense = { input: byId, output: Expense };
export const listExpenses = {
  input: listInput({
    legalEntityId: Uuid.optional(),
    supplierId: Uuid.optional(),
    status: ExpenseStatus.optional(),
    issuedFrom: IsoDate.optional(),
    issuedTo: IsoDate.optional(),
    search: z.string().optional(),
  }),
  output: paginated(Expense),
};

/** DEP-02/TRA-01: validation carries the allocation and the accounting treatment. */
export const validateExpense = {
  input: z.strictObject({
    id: Uuid,
    expectedVersion: Version,
    lines: z
      .array(
        z.strictObject({
          lineNumber: z.number().int().positive(),
          description: z.string().min(1),
          amountInclTax: Money,
          recoverableShare: z.string().optional(),
          allocations: z
            .array(
              z.strictObject({
                target: z.enum(["unit", "building_common", "entity_common"]),
                unitId: Uuid.optional(),
                buildingId: Uuid.optional(),
                legalEntityId: Uuid.optional(),
                amount: Money,
                recoverableAmount: Money.optional(),
              }),
            )
            .min(1),
          unallocatedAmount: Money,
        }),
      )
      .min(1),
  }),
  output: Expense,
};

export const listLoans = {
  input: listInput({ legalEntityId: Uuid.optional(), status: LoanStatus.optional() }),
  output: paginated(Loan),
};
export const getLoan = {
  input: byId,
  output: Loan.extend({ installments: z.array(LoanInstallment) }),
};
export const createLoan = { input: CreateLoanInput, output: Loan };
export const updateLoan = { input: UpdateLoanInput, output: Loan };

export const listCurrentAccounts = {
  input: listInput({ legalEntityId: Uuid.optional() }),
  output: paginated(PartnerCurrentAccount),
};
export const listCcaMovements = {
  input: listInput({ ccaId: Uuid.optional(), status: CcaMovementStatus.optional() }),
  output: paginated(CcaMovement),
};
export const createCcaMovement = { input: CreateCcaMovementInput, output: CcaMovement };

export const listFixedAssets = {
  input: listInput({ legalEntityId: Uuid.optional(), status: FixedAssetStatus.optional() }),
  output: paginated(FixedAsset),
};

/** MOD-02: every displayed figure carries its source and its read date. */
export const BankBalance = z.object({
  bankAccountId: Uuid,
  label: z.string(),
  balance: Money,
  currency: Currency,
  asOf: IsoDate,
  source: z.enum(["odoo", "saas_projection"]),
  readAt: IsoDateTime.nullable(),
});
export type BankBalance = z.infer<typeof BankBalance>;

export const getBankBalances = {
  input: z.strictObject({ legalEntityId: Uuid.optional() }),
  output: z.object({ balances: z.array(BankBalance) }),
};

export const ForecastHorizon = z.enum(["30", "90", "365"]);
export type ForecastHorizon = z.infer<typeof ForecastHorizon>;

export const getCashForecast = {
  input: z.strictObject({ legalEntityId: Uuid.optional(), horizonDays: ForecastHorizon }),
  output: z.object({
    horizonDays: ForecastHorizon,
    currency: Currency,
    openingBalance: Money,
    closingBalance: Money,
    asOf: IsoDate,
    buckets: z.array(
      z.object({
        on: IsoDate,
        inflow: Money,
        outflow: Money,
        balance: Money,
        sources: z.array(z.enum(["rent_term", "loan_installment", "expense", "booking", "other"])),
      }),
    ),
    missingSources: z.array(z.string()),
  }),
};
