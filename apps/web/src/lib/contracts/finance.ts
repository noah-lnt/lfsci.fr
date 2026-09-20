import {
  AssetComponent,
  api,
  CcaMovement,
  CreateAssetComponentInput,
  CreateCcaMovementInput,
  CreateFixedAssetInput,
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
  UpdateAssetComponentInput,
  UpdateFixedAssetInput,
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
  /** Question 10: the bank's rule, per loan; the schedule is built from it. */
  insuranceBasis: z.enum(["initial_principal", "outstanding_principal"]).optional(),
  feesMonthly: Money.optional(),
});
export type CreateLoanWithScheduleInput = z.infer<typeof CreateLoanWithScheduleInput>;

export const InstallmentWithMatch = LoanInstallment.extend({
  matchStatus: z.enum(["exact", "amount_mismatch", "no_debit"]),
  matchDifference: Money.nullable(),
});
export type InstallmentWithMatch = z.infer<typeof InstallmentWithMatch>;

export const InsuranceBasis = z.enum([
  "initial_principal",
  "outstanding_principal",
  "none",
  "unknown",
]);
export type InsuranceBasis = z.infer<typeof InsuranceBasis>;

export const LoanScheduleVersionSummary = z.object({
  id: Uuid,
  sequence: z.number().int().positive(),
  reason: z.string(),
  source: z.string().nullable(),
  effectiveFrom: IsoDate,
  status: z.string(),
  installments: z.number().int().nonnegative(),
});
export type LoanScheduleVersionSummary = z.infer<typeof LoanScheduleVersionSummary>;

export const LoanPropertyLink = z.object({
  id: Uuid,
  buildingId: Uuid.nullable(),
  unitId: Uuid.nullable(),
  label: z.string(),
  financedShare: z.string().nullable(),
});
export type LoanPropertyLink = z.infer<typeof LoanPropertyLink>;

export const LoanProgress = z.object({
  asOf: IsoDate,
  outstandingPrincipal: Money,
  outstandingSource: z.enum(["odoo", "saas_projection"]),
  capitalRepaid: Money,
  interestPaid: Money,
  insurancePaid: Money,
  feesPaid: Money,
  installmentsPaid: z.number().int().nonnegative(),
  installmentsLeft: z.number().int().nonnegative(),
  nextDueOn: IsoDate.nullable(),
  nextAmount: Money.nullable(),
});
export type LoanProgress = z.infer<typeof LoanProgress>;

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
  /** CRE-01: the schedule has versions; the screen shows which one it reads. */
  versions: z.array(LoanScheduleVersionSummary),
  activeVersionId: Uuid.nullable(),
  deferredInstallments: z.number().int().nonnegative(),
  /** CRE-02 / question 10: read back from the stored premiums, never assumed. */
  insuranceBasis: InsuranceBasis,
  /** The rule the owner chose for the loan; a disagreement with the premiums is shown, not hidden. */
  storedInsuranceBasis: z.enum(["initial_principal", "outstanding_principal"]),
  insuranceBasisMismatch: z.boolean(),
  progress: LoanProgress,
  properties: z.array(LoanPropertyLink),
});
export type LoanSchedule = z.infer<typeof LoanSchedule>;

export const LinkLoanPropertyInput = z.strictObject({
  loanId: Uuid,
  buildingId: Uuid.optional(),
  unitId: Uuid.optional(),
  financedShare: Share.optional(),
});
export type LinkLoanPropertyInput = z.infer<typeof LinkLoanPropertyInput>;

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

export const DurationSource = z.enum(["asset", "default", "none"]);
export type DurationSource = z.infer<typeof DurationSource>;

/** IMM-02: land is never depreciated; the VNC shown is ours, dated, next to Odoo's. */
export const FixedAssetPosition = FixedAsset.extend({
  netBookValueAt: Money,
  depreciableGross: Money,
  accumulatedAt: Money,
  computedOn: IsoDate,
  /** IMM-02 / question 9: `default` means the owner has not stated a duration yet. */
  durationSource: DurationSource,
  durationMonths: z.number().int().nonnegative(),
  componentCount: z.number().int().nonnegative(),
});
export type FixedAssetPosition = z.infer<typeof FixedAssetPosition>;

export const AssetComponentPosition = AssetComponent.extend({
  accumulated: Money,
  netBookValue: Money,
  durationSource: DurationSource,
  durationMonths: z.number().int().nonnegative(),
  computable: z.boolean(),
});
export type AssetComponentPosition = z.infer<typeof AssetComponentPosition>;

export const DepreciationYear = z.object({
  year: z.number().int(),
  amount: Money,
  cumulative: Money,
});
export type DepreciationYear = z.infer<typeof DepreciationYear>;

/** IMM-01: gross value, components, depreciation and NBV, all at one date. */
export const FixedAssetDetail = FixedAssetPosition.extend({
  buildingLabel: z.string().nullable(),
  unitLabel: z.string().nullable(),
  components: z.array(AssetComponentPosition),
  register: z.object({
    asOf: IsoDate,
    gross: Money,
    land: Money,
    depreciableGross: Money,
    accumulated: Money,
    netBookValue: Money,
    usesDefaultDuration: z.boolean(),
  }),
  years: z.array(DepreciationYear),
});
export type FixedAssetDetail = z.infer<typeof FixedAssetDetail>;

export const DisposeAssetInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  disposedOn: IsoDate,
  reason: z.string().min(1),
});
export type DisposeAssetInput = z.infer<typeof DisposeAssetInput>;

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
  /** The ledger's own balance, a dated read-only copy written by the back-sync only. */
  odooBalance: Money.nullable(),
  odooBalanceOn: IsoDate.nullable(),
  odooReadAt: IsoDateTime.nullable(),
  status: z.string(),
  version: Version,
});
export type BankAccountSummary = z.infer<typeof BankAccountSummary>;

export const BalanceBasis = z.enum(["ledger", "computed", "opening_only"]);
export type BalanceBasis = z.infer<typeof BalanceBasis>;

/**
 * BAN-01 / question 14: the ledger is the authority. `basis` says whether the
 * figure is the mirrored ledger's or a running total we computed, and no
 * balance is ever rendered without it.
 */
export const AccountBalance = z.object({
  bankAccountId: Uuid,
  label: z.string(),
  balance: Money,
  currency: Currency,
  asOf: IsoDate,
  basis: BalanceBasis,
  source: z.enum(["odoo", "saas_projection"]),
  readAt: IsoDateTime.nullable(),
  movements: z.number().int().nonnegative(),
  ledgerMovements: z.number().int().nonnegative(),
  importedMovements: z.number().int().nonnegative(),
});
export type AccountBalance = z.infer<typeof AccountBalance>;

export const BankTransactionRow = z.object({
  id: Uuid,
  bankAccountId: Uuid,
  bookedOn: IsoDate,
  valueOn: IsoDate.nullable(),
  amount: Money,
  currency: Currency,
  label: z.string().nullable(),
  counterpartyName: z.string().nullable(),
  reconciliationStatus: z.string(),
  fromLedger: z.boolean(),
  readAt: IsoDateTime.nullable(),
});
export type BankTransactionRow = z.infer<typeof BankTransactionRow>;

export const InternalTransferRow = z.object({
  id: Uuid,
  sourceBankAccountId: Uuid,
  targetBankAccountId: Uuid,
  sourceLabel: z.string(),
  targetLabel: z.string(),
  amount: Money,
  currency: Currency,
  initiatedOn: IsoDate,
  settledOn: IsoDate.nullable(),
  status: z.string(),
  version: Version,
});
export type InternalTransferRow = z.infer<typeof InternalTransferRow>;

export const BankOverview = z.object({
  asOf: IsoDate,
  currency: Currency,
  accounts: z.array(BankAccountSummary),
  balances: z.array(AccountBalance),
  total: Money,
  totalBasis: BalanceBasis,
  transfers: z.array(InternalTransferRow),
  unreconciled: z.number().int().nonnegative(),
});
export type BankOverview = z.infer<typeof BankOverview>;

export const CreateBankAccountInput = z.strictObject({
  legalEntityId: Uuid,
  label: z.string().min(1),
  bankName: z.string().min(1).optional(),
  ibanLast4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  purpose: z.enum(["operating", "deposit", "transit", "savings", "loan"]).optional(),
  openingBalance: Money.optional(),
  openingBalanceOn: IsoDate.optional(),
  feedSource: z.enum(["odoo_bank_sync", "odoo_manual_import", "fallback_import"]).optional(),
});
export type CreateBankAccountInput = z.infer<typeof CreateBankAccountInput>;

export const UpdateBankAccountInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  bankName: z.string().nullable().optional(),
  purpose: z.enum(["operating", "deposit", "transit", "savings", "loan"]).optional(),
  openingBalance: Money.optional(),
  openingBalanceOn: IsoDate.nullable().optional(),
  feedSource: z
    .enum(["odoo_bank_sync", "odoo_manual_import", "fallback_import"])
    .nullable()
    .optional(),
  status: z.enum(["active", "closed", "disconnected"]).optional(),
});
export type UpdateBankAccountInput = z.infer<typeof UpdateBankAccountInput>;

export const CreateInternalTransferInput = z.strictObject({
  legalEntityId: Uuid,
  sourceBankAccountId: Uuid,
  targetBankAccountId: Uuid,
  amount: Money,
  initiatedOn: IsoDate,
});
export type CreateInternalTransferInput = z.infer<typeof CreateInternalTransferInput>;

export const UpdateInternalTransferInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  settledOn: IsoDate.optional(),
  status: z.enum(["expected", "in_transit", "settled", "mismatch", "cancelled"]),
});
export type UpdateInternalTransferInput = z.infer<typeof UpdateInternalTransferInput>;

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
      update: oc
        .route({ method: "PATCH", path: "/finance/loans/{id}", summary: "Modifier le crédit" })
        .input(api.finance.updateLoan.input)
        .output(Loan),
      installments: oc
        .route({
          method: "GET",
          path: "/finance/loans/{id}/installments",
          summary: "Échéancier du crédit",
        })
        .input(z.strictObject({ id: Uuid }))
        .output(LoanSchedule),
      linkProperty: oc
        .route({
          method: "POST",
          path: "/finance/loans/{loanId}/properties",
          summary: "Rattacher un bien financé",
        })
        .input(LinkLoanPropertyInput)
        .output(z.object({ properties: z.array(LoanPropertyLink) })),
      unlinkProperty: oc
        .route({
          method: "DELETE",
          path: "/finance/loans/properties/{id}",
          summary: "Détacher un bien financé",
        })
        .input(z.strictObject({ id: Uuid }))
        .output(z.object({ properties: z.array(LoanPropertyLink) })),
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
        .output(FixedAssetDetail),
      create: oc
        .route({ method: "POST", path: "/finance/assets", summary: "Créer une immobilisation" })
        .input(CreateFixedAssetInput)
        .output(FixedAssetDetail),
      update: oc
        .route({
          method: "PATCH",
          path: "/finance/assets/{id}",
          summary: "Modifier l’immobilisation",
        })
        .input(UpdateFixedAssetInput)
        .output(FixedAssetDetail),
      dispose: oc
        .route({
          method: "POST",
          path: "/finance/assets/{id}/dispose",
          summary: "Sortir l’immobilisation",
        })
        .input(DisposeAssetInput)
        .output(FixedAssetDetail),
      addComponent: oc
        .route({
          method: "POST",
          path: "/finance/assets/{fixedAssetId}/components",
          summary: "Ajouter un composant",
        })
        .input(CreateAssetComponentInput)
        .output(FixedAssetDetail),
      updateComponent: oc
        .route({
          method: "PATCH",
          path: "/finance/assets/components/{id}",
          summary: "Modifier le composant",
        })
        .input(UpdateAssetComponentInput)
        .output(FixedAssetDetail),
      removeComponent: oc
        .route({
          method: "DELETE",
          path: "/finance/assets/components/{id}",
          summary: "Retirer le composant",
        })
        .input(z.strictObject({ id: Uuid }))
        .output(FixedAssetDetail),
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
      overview: oc
        .route({ method: "GET", path: "/finance/bank", summary: "Comptes, soldes et virements" })
        .input(z.strictObject(listFilters))
        .output(BankOverview),
      transactions: oc
        .route({ method: "GET", path: "/finance/bank/transactions", summary: "Mouvements" })
        .input(
          listInput({
            bankAccountId: Uuid.optional(),
            reconciliationStatus: z.string().optional(),
          }),
        )
        .output(paginated(BankTransactionRow)),
      createAccount: oc
        .route({
          method: "POST",
          path: "/finance/bank/accounts",
          summary: "Créer un compte bancaire",
        })
        .input(CreateBankAccountInput)
        .output(BankAccountSummary),
      updateAccount: oc
        .route({
          method: "PATCH",
          path: "/finance/bank/accounts/{id}",
          summary: "Modifier le compte bancaire",
        })
        .input(UpdateBankAccountInput)
        .output(BankAccountSummary),
      createTransfer: oc
        .route({
          method: "POST",
          path: "/finance/bank/transfers",
          summary: "Enregistrer un virement interne",
        })
        .input(CreateInternalTransferInput)
        .output(InternalTransferRow),
      updateTransfer: oc
        .route({
          method: "PATCH",
          path: "/finance/bank/transfers/{id}",
          summary: "Modifier le virement interne",
        })
        .input(UpdateInternalTransferInput)
        .output(InternalTransferRow),
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
