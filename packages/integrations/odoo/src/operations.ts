import { AppError, newId } from "@lfsci/kernel";
import { z } from "zod";
import { assertCapability, type CapabilitySnapshot, hasCapabilityField } from "./capability";
import type { OdooClient } from "./client";
import {
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  type OdooCursor,
  OVERLAP_MS,
  overlapFrom,
} from "./cursor";

export const DEFAULT_OPERATION_REF_FIELD = "x_lfsci_ref";
export const OPERATION_REF_PREFIX = "lfsci:";

export function newOperationRef(): string {
  return `${OPERATION_REF_PREFIX}${newId()}`;
}

const Many2one = z.union([z.tuple([z.number(), z.string()]), z.literal(false)]);
export type Many2one = z.infer<typeof Many2one>;

export function many2oneId(value: Many2one): number | null {
  return value === false ? null : value[0];
}

const OdooPartner = z.looseObject({
  id: z.number(),
  name: z.string(),
  ref: z.union([z.string(), z.literal(false)]).optional(),
  email: z.union([z.string(), z.literal(false)]).optional(),
  vat: z.union([z.string(), z.literal(false)]).optional(),
});
export type OdooPartner = z.infer<typeof OdooPartner>;

const OdooJournal = z.looseObject({
  id: z.number(),
  name: z.string(),
  code: z.string(),
  type: z.string(),
});
export type OdooJournal = z.infer<typeof OdooJournal>;

/** Measured on Odoo 18 Community (2026-09-20): `current_statement_balance` is a monetary on account.journal. */
const OdooBankJournalBalance = z.looseObject({
  id: z.number(),
  name: z.string(),
  current_statement_balance: z.union([z.number(), z.literal(false)]),
});
export type OdooBankJournalBalance = z.infer<typeof OdooBankJournalBalance>;

const OdooAccountMove = z.looseObject({
  id: z.number(),
  name: z.union([z.string(), z.literal(false)]),
  ref: z.union([z.string(), z.literal(false)]),
  state: z.string(),
  move_type: z.string(),
  date: z.union([z.string(), z.literal(false)]),
  amount_total: z.number(),
  amount_residual: z.number(),
  currency_id: Many2one,
  partner_id: Many2one,
  journal_id: Many2one,
  company_id: Many2one,
  payment_state: z.union([z.string(), z.literal(false)]),
  write_date: z.string(),
});
export type OdooAccountMove = z.infer<typeof OdooAccountMove>;

const OdooBankStatementLine = z.looseObject({
  id: z.number(),
  date: z.union([z.string(), z.literal(false)]),
  payment_ref: z.union([z.string(), z.literal(false)]),
  amount: z.number(),
  partner_id: Many2one,
  journal_id: Many2one,
  write_date: z.string(),
});
export type OdooBankStatementLine = z.infer<typeof OdooBankStatementLine>;

const OdooCompany = z.looseObject({ id: z.number(), name: z.string() });

const OdooAccount = z.looseObject({
  id: z.number(),
  code: z.union([z.string(), z.literal(false)]),
  name: z.string(),
});

const OdooAnalyticAccount = z.looseObject({
  id: z.number(),
  name: z.string(),
  code: z.union([z.string(), z.literal(false)]),
});

const OdooAnalyticPlan = z.looseObject({ id: z.number(), name: z.string() });

const CreatedIds = z.union([z.number(), z.array(z.number())]);

const partnerFields = ["id", "name", "ref", "email", "vat"];
const journalFields = ["id", "name", "code", "type"];
const moveFields = [
  "id",
  "name",
  "ref",
  "state",
  "move_type",
  "date",
  "amount_total",
  "amount_residual",
  "currency_id",
  "partner_id",
  "journal_id",
  "company_id",
  "payment_state",
  "write_date",
];
const bankStatementLineFields = [
  "id",
  "date",
  "payment_ref",
  "amount",
  "partner_id",
  "journal_id",
  "write_date",
];

/**
 * Measured with `fields_get` on Odoo 18.0-20260908 (docs/odoo-poc.md §Lock dates):
 * `period_lock_date` no longer exists, `sale_lock_date` and `purchase_lock_date`
 * replaced it, and `hard_lock_date` was added. The `user_*` twins are computed per
 * caller and are read for diagnosis only — the company fields carry the owner's
 * intent whatever rights the bot user holds.
 */
const lockDateFields = {
  fiscalyear_lock_date: "fiscalyear",
  tax_lock_date: "tax",
  sale_lock_date: "sale",
  purchase_lock_date: "purchase",
  hard_lock_date: "hard",
} as const;

/** Pre-18 name: requested only when a capability snapshot proves the field exists. */
const legacyLockDateField = "period_lock_date";

export type LockKind = "sale" | "purchase" | "entry";

export type OdooLockDates = {
  companyId: number;
  fiscalyear: string | null;
  tax: string | null;
  sale: string | null;
  purchase: string | null;
  hard: string | null;
  period: string | null;
};

export type OdooAccountCodes = {
  rent: string;
  charges: string;
  accessories: string;
  deposit: string;
  cca: string;
  ccaCounterpart: string;
  receivable: string;
};

/**
 * French chart codes measured on the local Odoo 18 instance (docs/odoo-poc.md).
 * The accountant has confirmed none of them: they are configuration, not law.
 */
export const DEFAULT_ACCOUNT_CODES: OdooAccountCodes = {
  rent: "708300",
  charges: "706000",
  accessories: "708800",
  deposit: "165100",
  cca: "455100",
  ccaCounterpart: "471000",
  receivable: "411100",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/** Odoo answers `false` for an unset lock and `1-01-01` on the computed twins. */
function lockDateOf(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value : null;
}

/** Money crosses the wire as a JSON number; a string that cannot round-trip is refused. */
export function moneyToWire(value: string, field: string): number {
  const trimmed = value.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new AppError("VALIDATION", {
      message: `montant décimal attendu pour ${field}`,
      details: { field, value },
    });
  }
  return Number(trimmed);
}

/**
 * True when the entity ends up owing the partner more, so the 455 account is
 * credited. `offset` reads as a repayment and `correction` follows its own sign
 * (docs/QUESTIONS.md item 12).
 */
export function ccaIncreases(kind: CcaEntryKind, signedAmount: number): boolean {
  if (kind === "correction") return signedAmount > 0;
  return kind === "contribution" || kind === "expense_paid_personally" || kind === "interest";
}

function invoiceLineValues(line: SupplierBillLine): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: line.name,
    price_unit: line.priceUnit,
    quantity: line.quantity ?? 1,
  };
  if (line.accountId !== undefined) values.account_id = line.accountId;
  if (line.taxIds !== undefined) values.tax_ids = [[6, 0, line.taxIds]];
  if (line.analyticDistribution !== undefined) {
    values.analytic_distribution = line.analyticDistribution;
  }
  return values;
}

function parseRecords<T>(schema: z.ZodType<T>, value: unknown, model: string, method: string): T[] {
  const result = z.array(schema).safeParse(value);
  if (!result.success) {
    throw new AppError("UPSTREAM_REJECTED", {
      message: "réponse Odoo au format inattendu",
      details: { model, method, issues: result.error.issues.slice(0, 5) },
    });
  }
  return result.data;
}

function firstCreatedId(value: unknown, model: string): number {
  const parsed = CreatedIds.safeParse(value);
  const id = parsed.success
    ? typeof parsed.data === "number"
      ? parsed.data
      : parsed.data[0]
    : undefined;
  if (id === undefined) {
    throw new AppError("UPSTREAM_REJECTED", {
      message: "création Odoo sans identifiant exploitable",
      details: { model, value },
    });
  }
  return id;
}

export type OdooPage<T> = {
  records: T[];
  nextCursor: string | undefined;
  hasMore: boolean;
};

export type OperationRefMatch =
  | { kind: "none" }
  | { kind: "one"; model: string; id: number }
  | { kind: "many"; matches: { model: string; id: number }[] };

export type SupplierBillLine = {
  name: string;
  priceUnit: number;
  quantity?: number;
  accountId?: number;
  taxIds?: number[];
  analyticDistribution?: Record<string, number>;
};

export type CreateCustomerInvoiceInput = {
  partnerId: number;
  invoiceDate: string;
  /** Odoo snaps a posting past a lock date unless the accounting date is explicit. */
  accountingDate?: string;
  lines: SupplierBillLine[];
  ref?: string;
  journalId?: number;
  currencyId?: number;
  companyId?: number;
  operationRef?: string;
};

export type CreateSupplierBillInput = {
  partnerId: number;
  invoiceDate: string;
  /** Odoo snaps a posting past a lock date unless the accounting date is explicit. */
  accountingDate?: string;
  lines: SupplierBillLine[];
  ref?: string;
  journalId?: number;
  currencyId?: number;
  companyId?: number;
  operationRef?: string;
};

export type AttachDocumentInput = {
  name: string;
  base64: string;
  resModel: string;
  resId: number;
  mimetype?: string;
  operationRef?: string;
};

export type ProposeReconciliationInput = {
  statementLineId: number;
  moveLineIds: number[];
  operationRef?: string;
};

export type AnalyticTarget = { code: string; label?: string };

export type PostRentInvoiceInput = {
  partnerId: number;
  invoiceDate: string;
  accountingDate: string;
  rentAmount: string;
  chargeAmount: string;
  accessoryAmount: string;
  unit?: AnalyticTarget;
  ref?: string;
  journalId?: number;
  currencyId?: number;
  companyId?: number;
  operationRef?: string;
};

export type PostedMove = {
  id: number;
  name: string | null;
  accountingDate: string | null;
  amountTotal: number;
  operationRef: string;
};

export type CcaEntryKind =
  | "contribution"
  | "expense_paid_personally"
  | "repayment"
  | "interest"
  | "offset"
  | "correction";

export type PostCcaEntryInput = {
  kind: CcaEntryKind;
  amount: string;
  accountingDate: string;
  label: string;
  partnerId?: number;
  journalId?: number;
  companyId?: number;
  operationRef?: string;
};

export type OdooOperationsOptions = {
  operationRefField?: string;
  capability?: CapabilitySnapshot | null;
  overlapMs?: number;
  pageSize?: number;
  /** Set once Phase 0 has read the real reconciliation entry point on `/doc`. */
  reconciliation?: { model: string; method: string };
  searchModels?: string[];
  /** Chart accounts, by code: unconfirmed by the accountant, hence configuration. */
  accounts?: Partial<OdooAccountCodes>;
  /** `account.analytic.account.plan_id` is mandatory (measured); absent, the first plan is used. */
  analyticPlanId?: number;
  companyId?: number;
  /** Lock dates are re-read at most this often; 0 reads them before every posting. */
  lockCacheMs?: number;
  now?: () => number;
};

export type OdooOperations = ReturnType<typeof createOdooOperations>;

export function createOdooOperations(client: OdooClient, options: OdooOperationsOptions = {}) {
  const refField = options.operationRefField ?? DEFAULT_OPERATION_REF_FIELD;
  const capability = options.capability ?? null;
  const overlapMs = options.overlapMs ?? OVERLAP_MS;
  const pageSize = options.pageSize ?? 200;
  const searchModels = options.searchModels ?? ["account.move", "res.partner", "ir.attachment"];
  const accounts: OdooAccountCodes = { ...DEFAULT_ACCOUNT_CODES, ...options.accounts };
  const lockCacheMs = options.lockCacheMs ?? 30_000;
  const now = options.now ?? Date.now;
  const accountIdByCode = new Map<string, number>();
  const analyticIdByCode = new Map<string, number>();
  const journalIdByType = new Map<string, number>();
  const lockCache = new Map<number | "default", { at: number; value: OdooLockDates }>();

  async function read<T>(
    schema: z.ZodType<T>,
    model: string,
    fields: string[],
    domain: unknown[],
    extra: Record<string, unknown> = {},
  ): Promise<T[]> {
    assertCapability(capability, model, "search_read");
    const value = await client.call(
      model,
      "search_read",
      { domain, fields, ...extra },
      { idempotent: true },
    );
    return parseRecords(schema, value, model, "search_read");
  }

  async function createRaw(model: string, vals: Record<string, unknown>): Promise<number> {
    assertCapability(capability, model, "create");
    const value = await client.call(model, "create", { vals_list: [vals] }, { idempotent: false });
    return firstCreatedId(value, model);
  }

  async function create(
    model: string,
    vals: Record<string, unknown>,
    operationRef: string,
  ): Promise<number> {
    return createRaw(model, { ...vals, [refField]: operationRef });
  }

  async function paginate<T extends { id: number; write_date: string }>(
    schema: z.ZodType<T>,
    model: string,
    fields: string[],
    since: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<OdooPage<T>> {
    const decoded: OdooCursor | undefined = cursor ? decodeCursor(cursor) : undefined;
    const domain = decoded
      ? [
          "|",
          ["write_date", ">", decoded.writeDate],
          "&",
          ["write_date", "=", decoded.writeDate],
          ["id", ">", decoded.id],
        ]
      : since === undefined
        ? []
        : [["write_date", ">=", overlapFrom(since, overlapMs)]];
    const rows = await read(schema, model, fields, domain, {
      order: "write_date asc, id asc",
      limit,
    });
    const records = rows.filter((row) =>
      isAfterCursor({ writeDate: row.write_date, id: row.id }, decoded),
    );
    const last = records.at(-1);
    return {
      records,
      nextCursor: last ? encodeCursor({ writeDate: last.write_date, id: last.id }) : cursor,
      hasMore: rows.length === limit,
    };
  }

  async function readLockDates(companyId?: number): Promise<OdooLockDates> {
    const key = companyId ?? "default";
    const cached = lockCache.get(key);
    if (cached && now() - cached.at < lockCacheMs) return cached.value;

    const fields = Object.keys(lockDateFields);
    if (hasCapabilityField(capability, "res.company", legacyLockDateField)) {
      fields.push(legacyLockDateField);
    }
    const domain = companyId === undefined ? [] : [["id", "=", companyId]];
    const rows = await read(OdooCompany, "res.company", ["id", "name", ...fields], domain, {
      limit: 2,
      order: "id asc",
    });
    const row = rows[0];
    if (!row) {
      throw new AppError("NOT_FOUND", {
        message: "société Odoo introuvable pour la lecture des dates de verrouillage",
        details: { companyId },
      });
    }
    if (companyId === undefined && rows.length > 1) {
      throw new AppError("AMBIGUOUS_REFERENCE", {
        message: "plusieurs sociétés Odoo : la société de l'écriture doit être explicite",
        details: { ids: rows.map((company) => company.id) },
      });
    }
    const value: OdooLockDates = {
      companyId: row.id,
      fiscalyear: lockDateOf(row.fiscalyear_lock_date),
      tax: lockDateOf(row.tax_lock_date),
      sale: lockDateOf(row.sale_lock_date),
      purchase: lockDateOf(row.purchase_lock_date),
      hard: lockDateOf(row.hard_lock_date),
      period: lockDateOf(row[legacyLockDateField]),
    };
    lockCache.set(key, { at: now(), value });
    return value;
  }

  /**
   * WF-12: Odoo 18 does not refuse a posting inside a locked period, it moves the
   * accounting date forward (measured, docs/odoo-poc.md step i). The refusal is
   * therefore ours, and it happens before the call. Odoo locks a date "prior to
   * and inclusive of" the lock, hence `<=`.
   */
  async function assertPeriodOpen(input: {
    date: string;
    kind: LockKind;
    companyId?: number;
  }): Promise<OdooLockDates> {
    const locks = await readLockDates(input.companyId);
    const applicable: [string, string | null][] = [
      ["hard", locks.hard],
      ["fiscalyear", locks.fiscalyear],
      ["tax", locks.tax],
      ["period", locks.period],
      ["sale", input.kind === "sale" ? locks.sale : null],
      ["purchase", input.kind === "purchase" ? locks.purchase : null],
    ];
    const blocking = applicable.filter(([, value]) => value !== null && input.date <= value);
    if (blocking.length > 0) {
      throw new AppError("PERIOD_LOCKED", {
        message: `période comptable verrouillée au ${blocking[0]?.[1]} : écriture au ${input.date} refusée`,
        details: {
          date: input.date,
          kind: input.kind,
          companyId: locks.companyId,
          locks: Object.fromEntries(blocking),
        },
      });
    }
    return locks;
  }

  async function resolveAccountId(code: string): Promise<number> {
    const cached = accountIdByCode.get(code);
    if (cached !== undefined) return cached;
    const rows = await read(
      OdooAccount,
      "account.account",
      ["id", "code", "name"],
      [["code", "=", code]],
      { limit: 2, order: "id asc" },
    );
    const row = rows[0];
    if (!row) {
      throw new AppError("NOT_FOUND", {
        message: `compte comptable ${code} absent du plan Odoo`,
        details: { code },
      });
    }
    if (rows.length > 1) {
      throw new AppError("AMBIGUOUS_REFERENCE", {
        message: `plusieurs comptes portent le code ${code}`,
        details: { code, ids: rows.map((account) => account.id) },
      });
    }
    accountIdByCode.set(code, row.id);
    return row.id;
  }

  async function resolveJournalId(type: string): Promise<number> {
    const cached = journalIdByType.get(type);
    if (cached !== undefined) return cached;
    const rows = await read(OdooJournal, "account.journal", journalFields, [["type", "=", type]], {
      limit: 1,
      order: "id asc",
    });
    const row = rows[0];
    if (!row) {
      throw new AppError("NOT_FOUND", {
        message: `aucun journal Odoo de type ${type}`,
        details: { type },
      });
    }
    journalIdByType.set(type, row.id);
    return row.id;
  }

  /** `account.analytic.account` carries no custom reference field (measured): keyed by `code`. */
  async function ensureAnalyticAccount(target: AnalyticTarget): Promise<number> {
    const cached = analyticIdByCode.get(target.code);
    if (cached !== undefined) return cached;
    const rows = await read(
      OdooAnalyticAccount,
      "account.analytic.account",
      ["id", "name", "code"],
      [["code", "=", target.code]],
      { limit: 2, order: "id asc" },
    );
    if (rows.length > 1) {
      throw new AppError("AMBIGUOUS_REFERENCE", {
        message: `plusieurs comptes analytiques portent le code ${target.code}`,
        details: { code: target.code, ids: rows.map((row) => row.id) },
      });
    }
    const existing = rows[0];
    if (existing) {
      analyticIdByCode.set(target.code, existing.id);
      return existing.id;
    }
    const planId = options.analyticPlanId ?? (await firstAnalyticPlanId());
    const id = await createRaw("account.analytic.account", {
      name: target.label ?? target.code,
      code: target.code,
      plan_id: planId,
    });
    analyticIdByCode.set(target.code, id);
    return id;
  }

  async function firstAnalyticPlanId(): Promise<number> {
    const rows = await read(OdooAnalyticPlan, "account.analytic.plan", ["id", "name"], [], {
      limit: 1,
      order: "id asc",
    });
    const row = rows[0];
    if (!row) {
      throw new AppError("RULE_VIOLATION", {
        message:
          "aucun plan analytique Odoo lisible : le compte de service doit appartenir au groupe Comptabilité analytique",
        details: { model: "account.analytic.plan" },
      });
    }
    return row.id;
  }

  async function readMove(id: number): Promise<OdooAccountMove> {
    const rows = await read(OdooAccountMove, "account.move", moveFields, [["id", "=", id]], {
      limit: 1,
    });
    const row = rows[0];
    if (!row) throw new AppError("NOT_FOUND", { details: { model: "account.move", id } });
    return row;
  }

  /**
   * The pre-flight cannot see a lock set between the read and the post, so the
   * posted date is compared with the one asked for: Odoo shifts it silently.
   */
  async function postAndVerify(id: number, accountingDate: string): Promise<OdooAccountMove> {
    await postMove({ id });
    const move = await readMove(id);
    if (move.date !== accountingDate) {
      throw new AppError("PERIOD_LOCKED", {
        message: `Odoo a déplacé la date comptable du ${accountingDate} au ${String(move.date)}`,
        details: { moveId: id, requested: accountingDate, posted: move.date },
      });
    }
    return move;
  }

  async function createDraftCustomerInvoice(
    input: CreateCustomerInvoiceInput,
  ): Promise<{ id: number; operationRef: string }> {
    const operationRef = input.operationRef ?? newOperationRef();
    await assertPeriodOpen({
      date: input.accountingDate ?? input.invoiceDate,
      kind: "sale",
      ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
    });
    const vals: Record<string, unknown> = {
      move_type: "out_invoice",
      partner_id: input.partnerId,
      invoice_date: input.invoiceDate,
      invoice_line_ids: input.lines.map((line) => [0, 0, invoiceLineValues(line)]),
    };
    if (input.accountingDate !== undefined) vals.date = input.accountingDate;
    if (input.ref !== undefined) vals.ref = input.ref;
    if (input.journalId !== undefined) vals.journal_id = input.journalId;
    if (input.currencyId !== undefined) vals.currency_id = input.currencyId;
    const id = await create("account.move", vals, operationRef);
    return { id, operationRef };
  }

  function lockKindOf(moveType: string): LockKind {
    if (moveType === "in_invoice" || moveType === "in_refund") return "purchase";
    if (moveType === "out_invoice" || moveType === "out_refund") return "sale";
    return "entry";
  }

  async function postMove(input: { id: number }): Promise<void> {
    const move = await readMove(input.id);
    const companyId = many2oneId(move.company_id) ?? options.companyId;
    if (typeof move.date === "string") {
      await assertPeriodOpen({
        date: move.date,
        kind: lockKindOf(move.move_type),
        ...(companyId === undefined ? {} : { companyId }),
      });
    }
    assertCapability(capability, "account.move", "action_post");
    await client.call("account.move", "action_post", { ids: [input.id] }, { idempotent: false });
  }

  return {
    operationRefField: refField,
    newOperationRef,
    accountCodes: accounts,
    readLockDates,
    assertPeriodOpen,
    resolveAccountId,
    resolveJournalId,
    ensureAnalyticAccount,
    readMove,

    readPartners(input: { limit?: number; offset?: number; domain?: unknown[] } = {}) {
      return read(OdooPartner, "res.partner", [...partnerFields, refField], input.domain ?? [], {
        limit: input.limit ?? pageSize,
        offset: input.offset ?? 0,
        order: "id asc",
      });
    },

    async findPartnerByRef(ref: string): Promise<OdooPartner | null> {
      const rows = await read(
        OdooPartner,
        "res.partner",
        [...partnerFields, refField],
        [["ref", "=", ref]],
        { limit: 2 },
      );
      if (rows.length === 0) return null;
      if (rows.length > 1) {
        throw new AppError("AMBIGUOUS_REFERENCE", {
          details: { model: "res.partner", ref, ids: rows.map((r) => r.id) },
        });
      }
      return rows[0] ?? null;
    },

    async createPartner(input: {
      name: string;
      ref?: string;
      email?: string;
      vat?: string;
      isCompany?: boolean;
      operationRef?: string;
    }): Promise<{ id: number; operationRef: string }> {
      const operationRef = input.operationRef ?? newOperationRef();
      const vals: Record<string, unknown> = { name: input.name };
      if (input.ref !== undefined) vals.ref = input.ref;
      if (input.email !== undefined) vals.email = input.email;
      if (input.vat !== undefined) vals.vat = input.vat;
      if (input.isCompany !== undefined) vals.is_company = input.isCompany;
      const id = await create("res.partner", vals, operationRef);
      return { id, operationRef };
    },

    readJournals(input: { types?: string[] } = {}) {
      const domain = input.types ? [["type", "in", input.types]] : [];
      return read(OdooJournal, "account.journal", journalFields, domain, { order: "id asc" });
    },

    readBankJournalBalances(input: { journalIds?: number[] } = {}) {
      const domain: unknown[] = [["type", "=", "bank"]];
      if (input.journalIds) domain.push(["id", "in", input.journalIds]);
      return read(
        OdooBankJournalBalance,
        "account.journal",
        ["id", "name", "current_statement_balance"],
        domain,
        { order: "id asc" },
      );
    },

    readAccountMoves(
      since?: string,
      cursor?: string,
      input: { limit?: number } = {},
    ): Promise<OdooPage<OdooAccountMove>> {
      return paginate(
        OdooAccountMove,
        "account.move",
        [...moveFields, refField],
        since,
        cursor,
        input.limit ?? pageSize,
      );
    },

    readBankStatementLines(
      since?: string,
      cursor?: string,
      input: { limit?: number } = {},
    ): Promise<OdooPage<OdooBankStatementLine>> {
      // to confirm on /doc (Phase 0): model name and readable fields for bank statement lines
      return paginate(
        OdooBankStatementLine,
        "account.bank.statement.line",
        [...bankStatementLineFields, refField],
        since,
        cursor,
        input.limit ?? pageSize,
      );
    },

    async createDraftSupplierBill(
      input: CreateSupplierBillInput,
    ): Promise<{ id: number; operationRef: string }> {
      const operationRef = input.operationRef ?? newOperationRef();
      const accountingDate = input.accountingDate ?? input.invoiceDate;
      await assertPeriodOpen({
        date: accountingDate,
        kind: "purchase",
        ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
      });
      // to confirm on /doc (Phase 0): x2many command triples accepted through JSON-2 create
      const lines = input.lines.map((line) => [0, 0, invoiceLineValues(line)]);
      const vals: Record<string, unknown> = {
        move_type: "in_invoice",
        partner_id: input.partnerId,
        invoice_date: input.invoiceDate,
        invoice_line_ids: lines,
      };
      if (input.accountingDate !== undefined) vals.date = input.accountingDate;
      if (input.ref !== undefined) vals.ref = input.ref;
      if (input.journalId !== undefined) vals.journal_id = input.journalId;
      if (input.currencyId !== undefined) vals.currency_id = input.currencyId;
      const id = await create("account.move", vals, operationRef);
      return { id, operationRef };
    },

    createDraftCustomerInvoice,

    async attachDocument(
      input: AttachDocumentInput,
    ): Promise<{ id: number; operationRef: string }> {
      const operationRef = input.operationRef ?? newOperationRef();
      // to confirm on /doc (Phase 0): ir.attachment.create with base64 `datas` is the upload path
      const vals: Record<string, unknown> = {
        name: input.name,
        datas: input.base64,
        res_model: input.resModel,
        res_id: input.resId,
      };
      if (input.mimetype !== undefined) vals.mimetype = input.mimetype;
      const id = await create("ir.attachment", vals, operationRef);
      return { id, operationRef };
    },

    // to confirm on /doc (Phase 0): action_post exposed to the bot user through JSON-2
    postMove,

    /**
     * FIN-01: rent, charges and accessories stay three lines carrying the unit's
     * analytic distribution, and the move keeps the operation reference.
     */
    async postRentInvoice(input: PostRentInvoiceInput): Promise<PostedMove> {
      const operationRef = input.operationRef ?? newOperationRef();
      await assertPeriodOpen({
        date: input.accountingDate,
        kind: "sale",
        ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
      });

      const analyticDistribution = input.unit
        ? { [String(await ensureAnalyticAccount(input.unit))]: 100 }
        : undefined;
      const parts: [string, string, string][] = [
        ["Loyer", input.rentAmount, accounts.rent],
        ["Provisions sur charges", input.chargeAmount, accounts.charges],
        ["Accessoires", input.accessoryAmount, accounts.accessories],
      ];
      const lines: SupplierBillLine[] = [];
      for (const [name, amount, code] of parts) {
        const priceUnit = moneyToWire(amount, name);
        if (priceUnit === 0) continue;
        lines.push({
          name,
          priceUnit,
          accountId: await resolveAccountId(code),
          ...(analyticDistribution ? { analyticDistribution } : {}),
        });
      }
      if (lines.length === 0) {
        throw new AppError("VALIDATION", {
          message: "terme de loyer sans montant : rien à facturer",
          details: { operationRef },
        });
      }

      const created = await createDraftCustomerInvoice({
        partnerId: input.partnerId,
        invoiceDate: input.invoiceDate,
        accountingDate: input.accountingDate,
        lines,
        operationRef,
        ...(input.ref === undefined ? {} : { ref: input.ref }),
        ...(input.journalId === undefined ? {} : { journalId: input.journalId }),
        ...(input.currencyId === undefined ? {} : { currencyId: input.currencyId }),
        ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
      });
      const move = await postAndVerify(created.id, input.accountingDate);
      return {
        id: move.id,
        name: move.name === false ? null : move.name,
        accountingDate: move.date === false ? null : move.date,
        amountTotal: move.amount_total,
        operationRef,
      };
    },

    /**
     * Partner current account (455): the counterpart account is configuration and
     * defaults to a suspense account — the accountant has not validated the template.
     */
    async postCcaEntry(input: PostCcaEntryInput): Promise<PostedMove> {
      const operationRef = input.operationRef ?? newOperationRef();
      await assertPeriodOpen({
        date: input.accountingDate,
        kind: "entry",
        ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
      });

      const signed = moneyToWire(input.amount, "amount");
      const increases = ccaIncreases(input.kind, signed);
      const amount = Math.abs(signed);
      if (amount === 0) {
        throw new AppError("VALIDATION", {
          message: "mouvement de compte courant à zéro",
          details: { operationRef },
        });
      }
      const ccaAccountId = await resolveAccountId(accounts.cca);
      const counterpartId = await resolveAccountId(accounts.ccaCounterpart);
      const journalId = input.journalId ?? (await resolveJournalId("general"));
      const partner = input.partnerId === undefined ? {} : { partner_id: input.partnerId };
      const ccaLine = {
        name: input.label,
        account_id: ccaAccountId,
        debit: increases ? 0 : amount,
        credit: increases ? amount : 0,
        ...partner,
      };
      const counterpartLine = {
        name: input.label,
        account_id: counterpartId,
        debit: increases ? amount : 0,
        credit: increases ? 0 : amount,
      };

      const id = await create(
        "account.move",
        {
          move_type: "entry",
          date: input.accountingDate,
          ref: input.label,
          journal_id: journalId,
          line_ids: [
            [0, 0, ccaLine],
            [0, 0, counterpartLine],
          ],
        },
        operationRef,
      );
      const move = await postAndVerify(id, input.accountingDate);
      return {
        id: move.id,
        name: move.name === false ? null : move.name,
        accountingDate: move.date === false ? null : move.date,
        amountTotal: move.amount_total,
        operationRef,
      };
    },

    async proposeReconciliation(input: ProposeReconciliationInput): Promise<unknown> {
      // to confirm on /doc (Phase 0): no reconciliation method is assumed; Phase 0 supplies it
      const target = options.reconciliation;
      if (!target) {
        throw new AppError("RULE_VIOLATION", {
          message: "aucune méthode de rapprochement Odoo confirmée : à établir en phase 0 sur /doc",
          details: { statementLineId: input.statementLineId },
        });
      }
      assertCapability(capability, target.model, target.method);
      return client.call(
        target.model,
        target.method,
        { ids: [input.statementLineId], move_line_ids: input.moveLineIds },
        { idempotent: false },
      );
    },

    /**
     * OCA `account_reconcile_oca`: the widget's two server calls, in order.
     * `add_multiple_lines` fills the serialised reconcile data, `reconcile_bank_line` posts it.
     */
    async reconcileBankLine(input: ProposeReconciliationInput): Promise<void> {
      assertCapability(capability, "account.bank.statement.line", "add_multiple_lines");
      await client.call(
        "account.bank.statement.line",
        "add_multiple_lines",
        { ids: [input.statementLineId], domain: [["id", "in", input.moveLineIds]] },
        { idempotent: false },
      );
      assertCapability(capability, "account.bank.statement.line", "reconcile_bank_line");
      await client.call(
        "account.bank.statement.line",
        "reconcile_bank_line",
        { ids: [input.statementLineId] },
        { idempotent: false },
      );
    },

    async findByOperationRef(
      ref: string,
      input: { models?: string[] } = {},
    ): Promise<OperationRefMatch> {
      const models = input.models ?? searchModels;
      const matches: { model: string; id: number }[] = [];
      for (const model of models) {
        assertCapability(capability, model, "search_read");
        const value = await client.call(
          model,
          "search_read",
          { domain: [[refField, "=", ref]], fields: ["id", refField], limit: 10 },
          { idempotent: true },
        );
        const rows = parseRecords(z.looseObject({ id: z.number() }), value, model, "search_read");
        for (const row of rows) matches.push({ model, id: row.id });
      }
      if (matches.length === 0) return { kind: "none" };
      const single = matches[0];
      if (matches.length === 1 && single)
        return { kind: "one", model: single.model, id: single.id };
      return { kind: "many", matches };
    },
  };
}
