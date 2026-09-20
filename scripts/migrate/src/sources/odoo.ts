import { decimal, toMoney } from "@lfsci/domain";
import { isAppError } from "@lfsci/kernel";
import type { Many2one, OdooClient, OdooOperations } from "@lfsci/odoo";
import { createOdooOperations, many2oneId } from "@lfsci/odoo";
import { z } from "zod";
import type {
  AssetRecord,
  BankLineRecord,
  ExpenseRecord,
  PersonRecord,
  Rejection,
  RentTermRecord,
  SourceRead,
  SourceReader,
  SourceRecord,
  SupplierRecord,
} from "../model";
import { SourceUnreachable } from "../model";

const ManyToOne = z.union([z.tuple([z.number(), z.string()]), z.literal(false)]);
const Text = z.union([z.string(), z.literal(false)]);

const Partner = z.looseObject({
  id: z.number(),
  name: z.string(),
  ref: Text.optional(),
  email: Text.optional(),
  vat: Text.optional(),
  is_company: z.boolean(),
  customer_rank: z.number(),
  supplier_rank: z.number(),
});

const Move = z.looseObject({
  id: z.number(),
  name: Text,
  move_type: z.string(),
  state: z.string(),
  date: Text,
  invoice_date_due: Text,
  amount_total: z.number(),
  amount_residual: z.number(),
  payment_state: Text,
  partner_id: ManyToOne,
  company_id: ManyToOne,
});

/**
 * `account.asset` is Enterprise-only and absent on the local Community (measured
 * 2026-09-20); these field names are unverified until the Online duplicate answers.
 */
const Asset = z.looseObject({
  id: z.number(),
  name: z.string(),
  original_value: z.number(),
  book_value: z.number(),
  acquisition_date: Text,
  company_id: ManyToOne,
});

export const PARTNER_FIELDS = [
  "id",
  "name",
  "ref",
  "email",
  "vat",
  "is_company",
  "customer_rank",
  "supplier_rank",
];
export const MOVE_FIELDS = [
  "id",
  "name",
  "move_type",
  "state",
  "date",
  "invoice_date_due",
  "amount_total",
  "amount_residual",
  "payment_state",
  "partner_id",
  "company_id",
];
export const ASSET_FIELDS = [
  "id",
  "name",
  "original_value",
  "book_value",
  "acquisition_date",
  "company_id",
];

const PAGE = 200;
const UNREACHABLE = new Set([
  "UPSTREAM_UNAVAILABLE",
  "RESULT_UNKNOWN",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "QUOTA_EXCEEDED",
]);

export type OdooSourceOptions = {
  client: OdooClient;
  operations?: OdooOperations;
  now?: () => Date;
};

function wire(amount: number): string {
  return toMoney(decimal(String(amount)));
}

function label(value: Many2one): string {
  return value === false ? "" : value[1];
}

function monthBounds(date: string): { start: string; end: string } {
  const [year, month] = date.split("-").map(Number);
  if (year === undefined || month === undefined) return { start: date, end: date };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${String(last).padStart(2, "0")}` };
}

function unreachable(model: string, error: unknown): SourceUnreachable {
  const code = isAppError(error) ? error.code : "ERROR";
  const message = error instanceof Error ? error.message : String(error);
  return new SourceUnreachable("odoo", `Odoo ${model}: ${code} — ${message}`, { cause: error });
}

export function createOdooSource(options: OdooSourceOptions): SourceReader {
  const { client } = options;
  const operations = options.operations ?? createOdooOperations(client);
  const now = options.now ?? (() => new Date());

  async function readAll<T>(
    model: string,
    fields: string[],
    schema: z.ZodType<T>,
    domain: unknown[] = [],
  ): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      let page: unknown;
      try {
        page = await client.call(
          model,
          "search_read",
          { domain, fields, limit: PAGE, offset, order: "id asc" },
          { idempotent: true },
        );
      } catch (error) {
        throw unreachable(model, error);
      }
      const rows = z.array(schema).parse(page);
      for (const row of rows) out.push(row);
      if (rows.length < PAGE) return out;
      offset += PAGE;
    }
  }

  async function readPartners(): Promise<{
    records: SourceRecord[];
    skipped: number;
    found: number;
  }> {
    const partners = await readAll("res.partner", PARTNER_FIELDS, Partner);
    const records: SourceRecord[] = [];
    let skipped = 0;
    for (const partner of partners) {
      const asSupplier = partner.supplier_rank > 0;
      const asPerson = partner.customer_rank > 0;
      if (!asSupplier && !asPerson) {
        skipped += 1;
        continue;
      }
      const ref = `res.partner:${partner.id}`;
      if (asSupplier) {
        const supplier: SupplierRecord = {
          source: "odoo",
          kind: "supplier",
          ref,
          name: partner.name,
          vat: partner.vat ? partner.vat : null,
          odooPartnerId: partner.id,
        };
        records.push(supplier);
      }
      if (asPerson) {
        const person: PersonRecord = {
          source: "odoo",
          kind: "person",
          ref,
          displayName: partner.name,
          email: partner.email ? partner.email : null,
          phone: null,
          odooPartnerId: partner.id,
        };
        records.push(person);
      }
    }
    return { records, skipped, found: partners.length };
  }

  function mapMove(
    move: z.infer<typeof Move>,
  ): { record: SourceRecord } | { rejection: Rejection } | null {
    const kind = move.move_type === "out_invoice" ? "rent_term" : "expense";
    const ref = `account.move:${move.id}`;
    if (move.state !== "posted") {
      return {
        rejection: {
          source: "odoo",
          kind,
          ref,
          reason: "not_posted",
          detail: `${move.name || ref} est ${move.state}, seules les pièces comptabilisées sont reprises`,
        },
      };
    }
    const partnerId = many2oneId(move.partner_id);
    if (partnerId === null) {
      return {
        rejection: {
          source: "odoo",
          kind,
          ref,
          reason: "missing_field",
          detail: `${move.name || ref} n’a pas de partenaire`,
        },
      };
    }
    if (!move.date) {
      return {
        rejection: {
          source: "odoo",
          kind,
          ref,
          reason: "invalid_date",
          detail: `${move.name || ref} n’a pas de date`,
        },
      };
    }
    const settled = move.amount_residual === 0 && move.payment_state !== "not_paid";
    if (kind === "rent_term") {
      const bounds = monthBounds(move.date);
      const record: RentTermRecord = {
        source: "odoo",
        kind,
        ref,
        entity: label(move.company_id),
        odooCompanyId: many2oneId(move.company_id),
        partnerName: label(move.partner_id),
        odooPartnerId: partnerId,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        dueOn: move.invoice_date_due || move.date,
        total: wire(move.amount_total),
        residual: wire(move.amount_residual),
        settled,
        odooMoveId: move.id,
        odooMoveName: move.name || ref,
      };
      return { record };
    }
    const record: ExpenseRecord = {
      source: "odoo",
      kind,
      ref,
      entity: label(move.company_id),
      odooCompanyId: many2oneId(move.company_id),
      supplierName: label(move.partner_id),
      odooPartnerId: partnerId,
      issuedOn: move.date,
      totalInclTax: wire(move.amount_total),
      residual: wire(move.amount_residual),
      paid: settled,
      odooMoveId: move.id,
      odooMoveName: move.name || ref,
    };
    return { record };
  }

  async function readBankLines(): Promise<BankLineRecord[]> {
    const out: BankLineRecord[] = [];
    let cursor: string | undefined;
    try {
      for (;;) {
        const page = await operations.readBankStatementLines(undefined, cursor, { limit: PAGE });
        for (const line of page.records) {
          if (!line.date) continue;
          out.push({
            source: "odoo",
            kind: "bank_line",
            ref: `account.bank.statement.line:${line.id}`,
            entity: "",
            odooCompanyId: null,
            journal: label(line.journal_id),
            odooJournalId: many2oneId(line.journal_id),
            date: line.date,
            amount: wire(line.amount),
            label: line.payment_ref || "",
          });
        }
        if (!page.hasMore || page.nextCursor === undefined) return out;
        cursor = page.nextCursor;
      }
    } catch (error) {
      throw unreachable("account.bank.statement.line", error);
    }
  }

  async function readAssets(): Promise<{ records: AssetRecord[]; note: string | null }> {
    try {
      const assets = await readAll("account.asset", ASSET_FIELDS, Asset);
      return {
        note: null,
        records: assets.map((asset) => ({
          source: "odoo",
          kind: "asset",
          ref: `account.asset:${asset.id}`,
          entity: label(asset.company_id),
          odooCompanyId: many2oneId(asset.company_id),
          label: asset.name,
          grossValue: wire(asset.original_value),
          accumulatedDepreciation: wire(asset.original_value - asset.book_value),
          netBookValue: wire(asset.book_value),
          commissionedOn: asset.acquisition_date || null,
          odooAssetId: asset.id,
        })),
      };
    } catch (error) {
      const cause = error instanceof SourceUnreachable ? error.cause : error;
      if (isAppError(cause) && UNREACHABLE.has(cause.code)) throw error;
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        records: [],
        note: `immobilisations : account.asset non lisible sur cette base (${message.slice(0, 120)}) — la VNC viendra de l’export de l’expert-comptable`,
      };
    }
  }

  return {
    name: "odoo",
    async read(): Promise<SourceRead> {
      const readAt = now().toISOString();
      const partners = await readPartners();
      const moves = await readAll("account.move", MOVE_FIELDS, Move, [
        ["move_type", "in", ["out_invoice", "in_invoice"]],
      ]);
      const bankLines = await readBankLines();
      const assets = await readAssets();

      const records: SourceRecord[] = [...partners.records];
      const rejections: Rejection[] = [];
      for (const move of moves) {
        const mapped = mapMove(move);
        if (mapped === null) continue;
        if ("record" in mapped) records.push(mapped.record);
        else rejections.push(mapped.rejection);
      }
      records.push(...bankLines, ...assets.records);

      const dates = [
        ...moves.map((move) => move.date || null),
        ...bankLines.map((line) => line.date),
      ]
        .filter((date): date is string => date !== null)
        .sort();

      const notes = [
        `partenaires : ${partners.found} lus, ${partners.skipped} sans rang client ni fournisseur ignorés (contacts, société, utilisateurs)`,
        `pièces : ${moves.length} factures clients et fournisseurs lues`,
        `banque : ${bankLines.length} lignes de relevé lues, reprises par la synchronisation Odoo, jamais par l’import`,
      ];
      if (assets.note) notes.push(assets.note);
      else notes.push(`immobilisations : ${assets.records.length} lues`);

      return {
        source: "odoo",
        label: `Odoo ${client.baseUrl}${client.database ? ` (${client.database})` : ""}`,
        found: partners.found + moves.length + bankLines.length + assets.records.length,
        records,
        rejections,
        notes,
        coverage: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
        readAt,
      };
    },
  };
}
