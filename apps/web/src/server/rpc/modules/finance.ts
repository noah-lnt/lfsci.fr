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
  CcaLedger,
  FinanceDashboard,
  FinanceLookups,
  FixedAssetPosition,
  LoanSchedule,
  RecordCcaMovementResult,
  ValidateExpenseResult,
} from "@/lib/contracts/finance";
import { tenant } from "../../data";
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
import { createLoan, getLoan, getSchedule, listLoans } from "../../finance/loans";
import { financeLookups } from "../../finance/lookups";
import {
  getAsset,
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
      installments: withOrganization.finance.loans.installments
        .use(validated(LoanSchedule))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getSchedule(tx, input.id))),
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
        .use(validated(FixedAssetPosition))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getAsset(tx, input.id))),
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
