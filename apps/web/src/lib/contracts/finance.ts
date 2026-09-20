import {
  api,
  CcaMovement,
  CreateCcaMovementInput,
  CreateLoanInput,
  Currency,
  DecisionLevel,
  Expense,
  ExpenseAllocationTarget,
  FixedAsset,
  IsoDate,
  IsoDateTime,
  Loan,
  LoanInstallment,
  listInput,
  Money,
  PartnerCurrentAccount,
  paginated,
  Share,
  Supplier,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const CreateSupplierInput = z.strictObject({
  name: z.string().min(1),
  trade: z.string().min(1).optional(),
  siren: z.string().min(9).max(14).optional(),
});
export type CreateSupplierInput = z.infer<typeof CreateSupplierInput>;

/** DEP-02: one form captures the expense, its lines and, when given, their allocation. */
export const CaptureExpenseWithLinesInput = api.finance.captureExpense.input.extend({
  supplierName: z.string().min(1).optional(),
  lines: z
    .array(
      z.strictObject({
        description: z.string().min(1),
        amountInclTax: Money,
        chargeNature: z.string().min(1).optional(),
        recoverableShare: z.string().optional(),
      }),
    )
    .min(1)
    .optional(),
});
export type CaptureExpenseWithLinesInput = z.infer<typeof CaptureExpenseWithLinesInput>;

export const UNALLOCATED_TARGET = "__unallocated__";

/**
 * CHA-01 / F05: the client sends shares, the server splits with the domain's
 * `allocateExpense`, so allocations plus the explicit residual equal the line
 * to the cent and the deferred database trigger passes at commit.
 */
export const AllocateExpenseInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  lines: z
    .array(
      z.strictObject({
        lineNumber: z.number().int().positive(),
        recoverableShare: Share.optional(),
        unallocatedShare: Share.optional(),
        targets: z
          .array(
            z.strictObject({
              target: ExpenseAllocationTarget,
              unitId: Uuid.optional(),
              buildingId: Uuid.optional(),
              legalEntityId: Uuid.optional(),
              share: Share,
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type AllocateExpenseInput = z.infer<typeof AllocateExpenseInput>;

export const ValidateExpenseInput = z.strictObject({ id: Uuid, expectedVersion: Version });
export type ValidateExpenseInput = z.infer<typeof ValidateExpenseInput>;

/** The command is only prepared here; the approval flow authorises it (tech pack §5). */
export const ValidateExpenseResult = z.object({
  expense: Expense,
  commandId: Uuid,
  commandStatus: z.string(),
  decisionLevel: DecisionLevel,
  isNewSupplier: z.boolean(),
  payerIsPartner: z.boolean(),
});
export type ValidateExpenseResult = z.infer<typeof ValidateExpenseResult>;

// loan.nominal_rate and loan.insurance_rate are stored as percentages
// (fixture 1.450000 = 1,45 %); buildSchedule takes an annual fraction.
export const CreateLoanWithScheduleInput = CreateLoanInput.extend({
  firstDueOn: IsoDate,
  deferralKind: z.enum(["partial", "total"]).optional(),
  insuranceMonthly: Money.optional(),
  feesMonthly: Money.optional(),
});
export type CreateLoanWithScheduleInput = z.infer<typeof CreateLoanWithScheduleInput>;

export const InstallmentWithMatch = LoanInstallment.extend({
  matchStatus: z.enum(["exact", "amount_mismatch", "no_debit"]),
  matchDifference: Money.nullable(),
});
export type InstallmentWithMatch = z.infer<typeof InstallmentWithMatch>;

export const LoanSchedule = z.object({
  loanId: Uuid,
  currency: Currency,
  installments: z.array(InstallmentWithMatch),
  totalPrincipal: Money,
  totalInterest: Money,
  totalInsurance: Money,
  totalFees: Money,
  totalPaid: Money,
  principalMatchesLoan: z.boolean(),
});
export type LoanSchedule = z.infer<typeof LoanSchedule>;

export const CcaLedgerEntry = z.object({
  id: Uuid,
  occurredOn: IsoDate,
  kind: z.string(),
  amount: Money,
  balance: Money,
  expense: Money,
  status: z.string(),
});
export type CcaLedgerEntry = z.infer<typeof CcaLedgerEntry>;

/** CCA-01: the Odoo balance is the official one; ours is a dated projection. */
export const CcaLedger = z.object({
  account: PartnerCurrentAccount,
  partnerName: z.string(),
  entries: z.array(CcaLedgerEntry),
  balance: Money,
  totalExpense: Money,
  direction: z.enum(["owed_to_partner", "owed_by_partner", "settled"]),
  odooBalance: Money.nullable(),
  odooReadAt: IsoDateTime.nullable(),
});
export type CcaLedger = z.infer<typeof CcaLedger>;

export const RecordCcaMovementResult = z.object({
  movement: CcaMovement.nullable(),
  commandId: Uuid,
  commandStatus: z.string(),
  decisionLevel: DecisionLevel,
});
export type RecordCcaMovementResult = z.infer<typeof RecordCcaMovementResult>;

/** IMM-02: land is never depreciated; the VNC shown is ours, dated, next to Odoo's. */
export const FixedAssetPosition = FixedAsset.extend({
  netBookValueAt: Money,
  depreciableGross: Money,
  accumulatedAt: Money,
  computedOn: IsoDate,
});
export type FixedAssetPosition = z.infer<typeof FixedAssetPosition>;

export const BankAccountSummary = z.object({
  id: Uuid,
  legalEntityId: Uuid,
  label: z.string(),
  bankName: z.string().nullable(),
  ibanLast4: z.string().nullable(),
  purpose: z.string(),
  currency: Currency,
  openingBalance: Money,
  openingBalanceOn: IsoDate.nullable(),
  feedSource: z.string().nullable(),
  feedLastSuccessAt: IsoDateTime.nullable(),
  status: z.string(),
});
export type BankAccountSummary = z.infer<typeof BankAccountSummary>;

export const FinanceKpi = z.object({
  amount: Money.nullable(),
  currency: Currency,
  asOf: IsoDate.nullable(),
  source: z.enum(["odoo", "saas_projection"]),
  detail: z.string().nullable(),
});
export type FinanceKpi = z.infer<typeof FinanceKpi>;

/** FIN-01: every figure carries its source and its read date. */
export const FinanceDashboard = z.object({
  asOf: IsoDate,
  currency: Currency,
  banks: FinanceKpi,
  treasury: FinanceKpi,
  debt: FinanceKpi,
  cca: FinanceKpi,
  netBookValue: FinanceKpi,
  nextInstallment: z
    .object({ dueOn: IsoDate, amount: Money, label: z.string(), kind: z.string() })
    .nullable(),
  unallocatedExpenses: Money,
});
export type FinanceDashboard = z.infer<typeof FinanceDashboard>;

export const NamedRef = z.object({ id: Uuid, label: z.string() });
export type NamedRef = z.infer<typeof NamedRef>;

/**
 * Pickers for the capture form. Patrimoine owns these objects; this read is a
 * label lookup, and it moves to `patrimoine.*` once that contract exposes one.
 */
export const FinanceLookups = z.object({
  legalEntities: z.array(NamedRef),
  buildings: z.array(NamedRef),
  units: z.array(NamedRef.extend({ buildingId: Uuid })),
  persons: z.array(NamedRef),
  suppliers: z.array(NamedRef),
  ccaAccounts: z.array(NamedRef),
});
export type FinanceLookups = z.infer<typeof FinanceLookups>;

const listFilters = { legalEntityId: Uuid.optional() };

export const financeContract = {
  finance: {
    expenses: {
      list: oc
        .route({ method: "GET", path: "/finance/expenses", summary: "Dépenses" })
        .input(api.finance.listExpenses.input)
        .output(api.finance.listExpenses.output),
      get: oc
        .route({ method: "GET", path: "/finance/expenses/{id}", summary: "Dépense" })
        .input(api.finance.getExpense.input)
        .output(Expense),
      capture: oc
        .route({ method: "POST", path: "/finance/expenses", summary: "Capturer une dépense" })
        .input(CaptureExpenseWithLinesInput)
        .output(Expense),
      update: oc
        .route({ method: "PATCH", path: "/finance/expenses/{id}", summary: "Modifier la dépense" })
        .input(api.finance.updateExpense.input)
        .output(Expense),
      allocate: oc
        .route({
          method: "POST",
          path: "/finance/expenses/{id}/allocate",
          summary: "Ventiler la dépense",
        })
        .input(AllocateExpenseInput)
        .output(Expense),
      validate: oc
        .route({
          method: "POST",
          path: "/finance/expenses/{id}/validate",
          summary: "Valider la dépense",
        })
        .input(ValidateExpenseInput)
        .output(ValidateExpenseResult),
    },
    suppliers: {
      list: oc
        .route({ method: "GET", path: "/finance/suppliers", summary: "Fournisseurs" })
        .input(listInput({ search: z.string().optional() }))
        .output(paginated(Supplier)),
      create: oc
        .route({ method: "POST", path: "/finance/suppliers", summary: "Créer un fournisseur" })
        .input(CreateSupplierInput)
        .output(Supplier),
    },
    loans: {
      list: oc
        .route({ method: "GET", path: "/finance/loans", summary: "Crédits" })
        .input(api.finance.listLoans.input)
        .output(paginated(Loan)),
      get: oc
        .route({ method: "GET", path: "/finance/loans/{id}", summary: "Crédit" })
        .input(api.finance.getLoan.input)
        .output(Loan),
      create: oc
        .route({ method: "POST", path: "/finance/loans", summary: "Créer un crédit" })
        .input(CreateLoanWithScheduleInput)
        .output(Loan),
      installments: oc
        .route({
          method: "GET",
          path: "/finance/loans/{id}/installments",
          summary: "Échéancier du crédit",
        })
        .input(z.strictObject({ id: Uuid }))
        .output(LoanSchedule),
    },
    cca: {
      list: oc
        .route({ method: "GET", path: "/finance/cca", summary: "Comptes courants d’associés" })
        .input(listInput(listFilters))
        .output(paginated(PartnerCurrentAccount)),
      get: oc
        .route({ method: "GET", path: "/finance/cca/{id}", summary: "Compte courant" })
        .input(z.strictObject({ id: Uuid }))
        .output(CcaLedger),
      movements: oc
        .route({ method: "GET", path: "/finance/cca/movements", summary: "Mouvements de CCA" })
        .input(api.finance.listCcaMovements.input)
        .output(paginated(CcaMovement)),
      record: oc
        .route({
          method: "POST",
          path: "/finance/cca/movements",
          summary: "Enregistrer un mouvement",
        })
        .input(CreateCcaMovementInput)
        .output(RecordCcaMovementResult),
    },
    assets: {
      list: oc
        .route({ method: "GET", path: "/finance/assets", summary: "Immobilisations" })
        .input(api.finance.listFixedAssets.input)
        .output(paginated(FixedAssetPosition)),
      get: oc
        .route({ method: "GET", path: "/finance/assets/{id}", summary: "Immobilisation" })
        .input(z.strictObject({ id: Uuid }))
        .output(FixedAssetPosition),
    },
    bank: {
      accounts: oc
        .route({ method: "GET", path: "/finance/bank/accounts", summary: "Comptes bancaires" })
        .input(z.strictObject(listFilters))
        .output(z.object({ accounts: z.array(BankAccountSummary) })),
      balances: oc
        .route({ method: "GET", path: "/finance/bank/balances", summary: "Soldes bancaires" })
        .input(api.finance.getBankBalances.input)
        .output(api.finance.getBankBalances.output),
    },
    forecast: oc
      .route({ method: "GET", path: "/finance/forecast", summary: "Prévision de trésorerie" })
      .input(api.finance.getCashForecast.input)
      .output(api.finance.getCashForecast.output),
    lookups: oc
      .route({ method: "GET", path: "/finance/lookups", summary: "Listes de sélection" })
      .input(z.strictObject({}))
      .output(FinanceLookups),
    dashboard: oc
      .route({ method: "GET", path: "/finance/dashboard", summary: "Tableau de bord financier" })
      .input(z.strictObject(listFilters))
      .output(FinanceDashboard),
  },
};
