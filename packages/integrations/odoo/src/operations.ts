import { AppError, newId } from "@lfsci/kernel";
import { z } from "zod";
import { assertCapability, type CapabilitySnapshot } from "./capability";
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
  operationRef?: string;
};

export type CreateSupplierBillInput = {
  partnerId: number;
  invoiceDate: string;
  lines: SupplierBillLine[];
  ref?: string;
  journalId?: number;
  currencyId?: number;
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

export type OdooOperationsOptions = {
  operationRefField?: string;
  capability?: CapabilitySnapshot | null;
  overlapMs?: number;
  pageSize?: number;
  /** Set once Phase 0 has read the real reconciliation entry point on `/doc`. */
  reconciliation?: { model: string; method: string };
  searchModels?: string[];
};

export type OdooOperations = ReturnType<typeof createOdooOperations>;

export function createOdooOperations(client: OdooClient, options: OdooOperationsOptions = {}) {
  const refField = options.operationRefField ?? DEFAULT_OPERATION_REF_FIELD;
  const capability = options.capability ?? null;
  const overlapMs = options.overlapMs ?? OVERLAP_MS;
  const pageSize = options.pageSize ?? 200;
  const searchModels = options.searchModels ?? ["account.move", "res.partner", "ir.attachment"];

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

  async function create(
    model: string,
    vals: Record<string, unknown>,
    operationRef: string,
  ): Promise<number> {
    assertCapability(capability, model, "create");
    const value = await client.call(
      model,
      "create",
      { vals_list: [{ ...vals, [refField]: operationRef }] },
      { idempotent: false },
    );
    return firstCreatedId(value, model);
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

  return {
    operationRefField: refField,
    newOperationRef,

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
      // to confirm on /doc (Phase 0): x2many command triples accepted through JSON-2 create
      const lines = input.lines.map((line) => [0, 0, invoiceLineValues(line)]);
      const vals: Record<string, unknown> = {
        move_type: "in_invoice",
        partner_id: input.partnerId,
        invoice_date: input.invoiceDate,
        invoice_line_ids: lines,
      };
      if (input.ref !== undefined) vals.ref = input.ref;
      if (input.journalId !== undefined) vals.journal_id = input.journalId;
      if (input.currencyId !== undefined) vals.currency_id = input.currencyId;
      const id = await create("account.move", vals, operationRef);
      return { id, operationRef };
    },

    async createDraftCustomerInvoice(
      input: CreateCustomerInvoiceInput,
    ): Promise<{ id: number; operationRef: string }> {
      const operationRef = input.operationRef ?? newOperationRef();
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
    },

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

    async postMove(input: { id: number }): Promise<void> {
      // to confirm on /doc (Phase 0): action_post exposed to the bot user through JSON-2
      assertCapability(capability, "account.move", "action_post");
      await client.call("account.move", "action_post", { ids: [input.id] }, { idempotent: false });
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
