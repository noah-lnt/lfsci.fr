import "server-only";
import {
  api,
  CcaMovement,
  Expense,
  Loan,
  PartnerCurrentAccount,
  paginated,
  Supplier,
} from "@lfsci/contracts";
import { z } from "zod";
import {
  BankAccountSummary,
  BankOverview,
  BankTransactionRow,
  CcaLedger,
  FinanceDashboard,
  FinanceLookups,
  FixedAssetDetail,
  FixedAssetPosition,
  InternalTransferRow,
  LoanPropertyLink,
  LoanSchedule,
  RecordCcaMovementResult,
  ValidateExpenseResult,
} from "@/lib/contracts/finance";
import { tenant } from "../../data";
import {
  addComponent,
  createAsset,
  disposeAsset,
  getAssetDetail,
  removeComponent,
  updateAsset,
  updateComponent,
} from "../../finance/assets";
import {
  bankOverview,
  createAccount,
  createTransfer,
  listTransactions,
  updateAccount,
  updateTransfer,
} from "../../finance/bank";
import {
  getCurrentAccount,
  listCurrentAccounts,
  listMovements,
  recordMovement,
} from "../../finance/cca";
import {
  allocateExpense,
  captureExpense,
  createSupplier,
  getExpense,
  listExpenses,
  listSuppliers,
  updateExpense,
  validateExpense,
} from "../../finance/expenses";
import {
  createLoan,
  getLoan,
  getSchedule,
  linkProperty,
  listLoans,
  unlinkProperty,
  updateLoan,
} from "../../finance/loans";
import { financeLookups } from "../../finance/lookups";
import {
  getBankBalances,
  getDashboard,
  getForecast,
  listAssets,
  listBankAccounts,
} from "../../finance/portfolio";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

type Scoped = RpcContext & { organizationId: string };

function actorOf(context: Scoped) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.session?.user.id ?? null,
  };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

export const financeRouter = {
  finance: {
    expenses: {
      list: withOrganization.finance.expenses.list
        .use(validated(api.finance.listExpenses.output))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listExpenses(tx, input))),
      get: withOrganization.finance.expenses.get
        .use(validated(Expense))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getExpense(tx, input.id))),
      capture: withOrganization.finance.expenses.capture
        .use(validated(Expense))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => captureExpense(tx, actorOf(context), input)),
        ),
      update: withOrganization.finance.expenses.update
        .use(validated(Expense))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateExpense(tx, actorOf(context), input)),
        ),
      allocate: withOrganization.finance.expenses.allocate
        .use(validated(Expense))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => allocateExpense(tx, actorOf(context), input)),
        ),
      validate: withOrganization.finance.expenses.validate
        .use(validated(ValidateExpenseResult))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => validateExpense(tx, actorOf(context), input)),
        ),
    },
    suppliers: {
      list: withOrganization.finance.suppliers.list
        .use(validated(paginated(Supplier)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listSuppliers(tx, input))),
      create: withOrganization.finance.suppliers.create
        .use(validated(Supplier))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createSupplier(tx, actorOf(context), input)),
        ),
    },
    loans: {
      list: withOrganization.finance.loans.list
        .use(validated(paginated(Loan)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listLoans(tx, input))),
      get: withOrganization.finance.loans.get
        .use(validated(Loan))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getLoan(tx, input.id))),
      create: withOrganization.finance.loans.create
        .use(validated(Loan))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createLoan(tx, actorOf(context), input)),
        ),
      update: withOrganization.finance.loans.update
        .use(validated(Loan))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateLoan(tx, actorOf(context), input)),
        ),
      installments: withOrganization.finance.loans.installments
        .use(validated(LoanSchedule))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getSchedule(tx, input.id))),
      linkProperty: withOrganization.finance.loans.linkProperty
        .use(validated(z.object({ properties: z.array(LoanPropertyLink) })))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => linkProperty(tx, actorOf(context), input)),
        ),
      unlinkProperty: withOrganization.finance.loans.unlinkProperty
        .use(validated(z.object({ properties: z.array(LoanPropertyLink) })))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => unlinkProperty(tx, actorOf(context), input.id)),
        ),
    },
    cca: {
      list: withOrganization.finance.cca.list
        .use(validated(paginated(PartnerCurrentAccount)))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => listCurrentAccounts(tx, input)),
        ),
      get: withOrganization.finance.cca.get
        .use(validated(CcaLedger))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => getCurrentAccount(tx, input.id)),
        ),
      movements: withOrganization.finance.cca.movements
        .use(validated(paginated(CcaMovement)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listMovements(tx, input))),
      record: withOrganization.finance.cca.record
        .use(validated(RecordCcaMovementResult))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => recordMovement(tx, actorOf(context), input)),
        ),
    },
    assets: {
      list: withOrganization.finance.assets.list
        .use(validated(paginated(FixedAssetPosition)))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listAssets(tx, input))),
      get: withOrganization.finance.assets.get
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => getAssetDetail(tx, input.id)),
        ),
      create: withOrganization.finance.assets.create
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createAsset(tx, actorOf(context), input)),
        ),
      update: withOrganization.finance.assets.update
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateAsset(tx, actorOf(context), input)),
        ),
      dispose: withOrganization.finance.assets.dispose
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => disposeAsset(tx, actorOf(context), input)),
        ),
      addComponent: withOrganization.finance.assets.addComponent
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => addComponent(tx, actorOf(context), input)),
        ),
      updateComponent: withOrganization.finance.assets.updateComponent
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateComponent(tx, actorOf(context), input)),
        ),
      removeComponent: withOrganization.finance.assets.removeComponent
        .use(validated(FixedAssetDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => removeComponent(tx, actorOf(context), input.id)),
        ),
    },
    bank: {
      accounts: withOrganization.finance.bank.accounts
        .use(validated(z.object({ accounts: z.array(BankAccountSummary) })))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => listBankAccounts(tx, input)),
        ),
      balances: withOrganization.finance.bank.balances
        .use(validated(api.finance.getBankBalances.output))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => getBankBalances(tx, input)),
        ),
      overview: withOrganization.finance.bank.overview
        .use(validated(BankOverview))
        .handler(({ context, input }) => tenant(scope(context), (tx) => bankOverview(tx, input))),
      transactions: withOrganization.finance.bank.transactions
        .use(validated(paginated(BankTransactionRow)))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => listTransactions(tx, input)),
        ),
      createAccount: withOrganization.finance.bank.createAccount
        .use(validated(BankAccountSummary))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createAccount(tx, actorOf(context), input)),
        ),
      updateAccount: withOrganization.finance.bank.updateAccount
        .use(validated(BankAccountSummary))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateAccount(tx, actorOf(context), input)),
        ),
      createTransfer: withOrganization.finance.bank.createTransfer
        .use(validated(InternalTransferRow))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createTransfer(tx, actorOf(context), input)),
        ),
      updateTransfer: withOrganization.finance.bank.updateTransfer
        .use(validated(InternalTransferRow))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateTransfer(tx, actorOf(context), input)),
        ),
    },
    forecast: withOrganization.finance.forecast
      .use(validated(api.finance.getCashForecast.output))
      .handler(({ context, input }) => tenant(scope(context), (tx) => getForecast(tx, input))),
    lookups: withOrganization.finance.lookups
      .use(validated(FinanceLookups))
      .handler(({ context }) => tenant(scope(context), (tx) => financeLookups(tx))),
    dashboard: withOrganization.finance.dashboard
      .use(validated(FinanceDashboard))
      .handler(({ context, input }) => tenant(scope(context), (tx) => getDashboard(tx, input))),
  },
};
