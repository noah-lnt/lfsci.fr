import type { DbHandle } from "@lfsci/db";
import { withTenant } from "@lfsci/db";
import { decimal, neg, sum, toMoney } from "@lfsci/domain";
import { isAppError } from "@lfsci/kernel";
import type { OdooClient } from "@lfsci/odoo";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { CsvError, parseCsv } from "./csv";
import { mapTable, parseMoney, resolveMapping } from "./mapping";
import { SourceUnreachable } from "./model";
import { nameKey } from "./normalise";
import { readCsvFile } from "./sources/spreadsheet";

export type BalanceKind = "tenant" | "deposit" | "loan" | "cca" | "bank" | "nbv";

export type BalanceLine = {
  entity: string;
  odooCompanyId: number | null;
  kind: BalanceKind;
  reference: string;
  odooPartnerId: number | null;
  odooJournalId: number | null;
  amount: string;
};

export type BalanceSet = { asOf: string; source: string; lines: BalanceLine[] };

export type BalanceDifference = {
  entity: string;
  kind: BalanceKind;
  reference: string;
  app: string | null;
  ledger: string | null;
  difference: string;
  matchedOn: "odoo_id" | "name" | "none";
};

export type BalanceReport = {
  asOf: string;
  organizationId: string;
  appSource: string;
  ledgerSource: string;
  lines: BalanceDifference[];
  equal: number;
  different: number;
  blockers: string[];
};

/** Chart prefixes: defaults follow DEFAULT_ACCOUNT_CODES, the accountant confirms them (P3). */
export type AccountPrefixes = {
  receivable: string;
  deposit: string;
  loan: string;
  cca: string;
  asset: string;
  depreciation: string;
};

export const DEFAULT_PREFIXES: AccountPrefixes = {
  receivable: "411",
  deposit: "165",
  loan: "164",
  cca: "455",
  asset: "21",
  depreciation: "28",
};

export interface LedgerReader {
  readonly label: string;
  read(asOf: string): Promise<BalanceSet>;
}

type Raw = Record<string, unknown>;

async function rows<T extends Raw>(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return [...(await tx.execute<T>(query))] as T[];
}

export async function readAppBalances(
  db: DbHandle,
  organizationId: string,
  asOf: string,
): Promise<BalanceSet> {
  try {
    return await withTenant(db, { organizationId }, async (tx) => {
      const lines: BalanceLine[] = [];
      const tenants = await rows<{
        entity: string;
        odoo_company_id: number | null;
        person: string;
        odoo_partner_id: number | null;
        balance: string;
      }>(
        tx,
        sql`SELECT le.name AS entity, le.odoo_company_id, p.display_name AS person, p.odoo_partner_id,
                   (COALESCE(sum(v.total_amount), 0)
                    - COALESCE((SELECT sum(a.amount) FROM payment_allocation a
                                 JOIN rent_term t2 ON t2.id = a.rent_term_id
                                 JOIN lease_party lp2 ON lp2.lease_id = t2.lease_id AND lp2.role = 'holder'
                                 JOIN lease l2 ON l2.id = t2.lease_id
                                WHERE lp2.person_id = p.id AND l2.legal_entity_id = le.id
                                  AND a.allocated_on <= ${asOf}::date AND a.reversed_at IS NULL), 0))::text
                     AS balance
              FROM lease l
              JOIN legal_entity le ON le.id = l.legal_entity_id
              JOIN lease_party lp ON lp.lease_id = l.id AND lp.role = 'holder'
              JOIN person p ON p.id = lp.person_id
              LEFT JOIN rent_term t ON t.lease_id = l.id AND t.due_on <= ${asOf}::date
                                    AND t.status <> 'cancelled'
              LEFT JOIN rent_term_version v ON v.id = t.current_version_id
             GROUP BY le.id, le.name, le.odoo_company_id, p.id, p.display_name, p.odoo_partner_id
             ORDER BY le.name, p.display_name`,
      );
      for (const row of tenants) {
        lines.push({
          entity: row.entity,
          odooCompanyId: row.odoo_company_id,
          kind: "tenant",
          reference: row.person,
          odooPartnerId: row.odoo_partner_id,
          odooJournalId: null,
          amount: toMoney(decimal(row.balance)),
        });
      }

      const deposits = await rows<{
        entity: string;
        odoo_company_id: number | null;
        balance: string;
      }>(
        tx,
        sql`SELECT le.name AS entity, le.odoo_company_id,
                   COALESCE(sum(CASE m.kind
                     WHEN 'received' THEN m.amount
                     WHEN 'interest' THEN m.amount
                     WHEN 'adjustment' THEN m.amount
                     ELSE -m.amount END), 0)::text AS balance
              FROM legal_entity le
              LEFT JOIN lease l ON l.legal_entity_id = le.id
              LEFT JOIN deposit_account d ON d.lease_id = l.id
              LEFT JOIN deposit_movement m ON m.deposit_account_id = d.id
                                          AND m.occurred_on <= ${asOf}::date
             GROUP BY le.id, le.name, le.odoo_company_id ORDER BY le.name`,
      );
      for (const row of deposits) {
        lines.push(entityLine(row, "deposit", "dépôts de garantie", row.balance));
      }

      const loans = await rows<{ entity: string; odoo_company_id: number | null; balance: string }>(
        tx,
        sql`SELECT le.name AS entity, le.odoo_company_id,
                   COALESCE(sum(COALESCE(
                     (SELECT i.remaining_principal FROM loan_installment i
                       JOIN loan_schedule_version s ON s.id = i.schedule_version_id
                      WHERE s.loan_id = lo.id AND i.due_on <= ${asOf}::date
                        AND i.status <> 'cancelled' AND i.remaining_principal IS NOT NULL
                      ORDER BY i.due_on DESC, i.installment_number DESC LIMIT 1),
                     CASE WHEN lo.released_on IS NULL OR lo.released_on <= ${asOf}::date
                          THEN lo.principal_amount ELSE 0 END)), 0)::text AS balance
              FROM legal_entity le
              LEFT JOIN loan lo ON lo.legal_entity_id = le.id AND lo.status IN ('active', 'renegotiated')
             GROUP BY le.id, le.name, le.odoo_company_id ORDER BY le.name`,
      );
      for (const row of loans) lines.push(entityLine(row, "loan", "emprunts", row.balance));

      const cca = await rows<{
        entity: string;
        odoo_company_id: number | null;
        person: string;
        odoo_partner_id: number | null;
        balance: string;
      }>(
        tx,
        sql`SELECT le.name AS entity, le.odoo_company_id, p.display_name AS person, p.odoo_partner_id,
                   COALESCE(sum(CASE m.kind
                     WHEN 'repayment' THEN -m.amount
                     WHEN 'offset' THEN -m.amount
                     ELSE m.amount END), 0)::text AS balance
              FROM partner_current_account c
              JOIN legal_entity le ON le.id = c.legal_entity_id
              JOIN person p ON p.id = c.partner_person_id
              LEFT JOIN cca_movement m ON m.cca_id = c.id AND m.occurred_on <= ${asOf}::date
                                       AND m.status IN ('validated', 'posted')
             GROUP BY le.id, le.name, le.odoo_company_id, p.id, p.display_name, p.odoo_partner_id
             ORDER BY le.name, p.display_name`,
      );
      for (const row of cca) {
        lines.push({
          entity: row.entity,
          odooCompanyId: row.odoo_company_id,
          kind: "cca",
          reference: row.person,
          odooPartnerId: row.odoo_partner_id,
          odooJournalId: null,
          amount: toMoney(decimal(row.balance)),
        });
      }

      const bank = await rows<{
        entity: string;
        odoo_company_id: number | null;
        label: string;
        odoo_journal_id: number | null;
        balance: string;
      }>(
        tx,
        sql`SELECT le.name AS entity, le.odoo_company_id, b.label, b.odoo_journal_id,
                   (b.opening_balance + COALESCE(sum(t.amount), 0))::text AS balance
              FROM bank_account b
              JOIN legal_entity le ON le.id = b.legal_entity_id
              LEFT JOIN bank_transaction t ON t.bank_account_id = b.id AND t.booked_on <= ${asOf}::date
             WHERE b.status <> 'closed'
             GROUP BY le.id, le.name, le.odoo_company_id, b.id, b.label, b.odoo_journal_id, b.opening_balance
             ORDER BY le.name, b.label`,
      );
      for (const row of bank) {
        lines.push({
          entity: row.entity,
          odooCompanyId: row.odoo_company_id,
          kind: "bank",
          reference: row.label,
          odooPartnerId: null,
          odooJournalId: row.odoo_journal_id,
          amount: toMoney(decimal(row.balance)),
        });
      }

      const nbv = await rows<{ entity: string; odoo_company_id: number | null; balance: string }>(
        tx,
        sql`SELECT le.name AS entity, le.odoo_company_id,
                   COALESCE(sum(COALESCE(a.net_book_value, a.gross_value - a.accumulated_depreciation)), 0)::text
                     AS balance
              FROM legal_entity le
              LEFT JOIN fixed_asset a ON a.legal_entity_id = le.id
                                      AND a.status IN ('running', 'fully_depreciated')
                                      AND (a.commissioned_on IS NULL OR a.commissioned_on <= ${asOf}::date)
             GROUP BY le.id, le.name, le.odoo_company_id ORDER BY le.name`,
      );
      for (const row of nbv)
        lines.push(entityLine(row, "nbv", "valeur nette comptable", row.balance));

      return { asOf, source: "application", lines };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SourceUnreachable("spreadsheet", `Base de l’application injoignable : ${message}`, {
      cause: error,
    });
  }
}

function entityLine(
  row: { entity: string; odoo_company_id: number | null },
  kind: BalanceKind,
  reference: string,
  balance: string,
): BalanceLine {
  return {
    entity: row.entity,
    odooCompanyId: row.odoo_company_id,
    kind,
    reference,
    odooPartnerId: null,
    odooJournalId: null,
    amount: toMoney(decimal(balance)),
  };
}

const ManyToOne = z.union([z.tuple([z.number(), z.string()]), z.literal(false)]);
const MoveLine = z.looseObject({
  id: z.number(),
  balance: z.number(),
  account_id: ManyToOne,
  partner_id: ManyToOne,
  company_id: ManyToOne,
  journal_id: ManyToOne,
  account_type: z.string(),
});
const Account = z.looseObject({ id: z.number(), code: z.union([z.string(), z.literal(false)]) });
const BankJournal = z.looseObject({
  id: z.number(),
  name: z.string(),
  default_account_id: ManyToOne,
});

export const MOVE_LINE_FIELDS = [
  "id",
  "balance",
  "account_id",
  "partner_id",
  "company_id",
  "journal_id",
  "account_type",
];

const PAGE = 500;

/**
 * Posted move lines up to the date, aggregated here: `balance` is debit minus
 * credit, so liabilities (165, 164, 455) are negated to read as what is owed.
 */
export function createOdooLedger(
  client: OdooClient,
  prefixes: AccountPrefixes = DEFAULT_PREFIXES,
): LedgerReader {
  async function call<T>(model: string, kwargs: Record<string, unknown>, schema: z.ZodType<T>) {
    try {
      const value = await client.call(model, "search_read", kwargs, { idempotent: true });
      return z.array(schema).parse(value);
    } catch (error) {
      const code = isAppError(error) ? error.code : "ERROR";
      const message = error instanceof Error ? error.message : String(error);
      throw new SourceUnreachable("odoo", `Odoo ${model}: ${code} — ${message}`, { cause: error });
    }
  }
  return {
    label: `Odoo ${client.baseUrl}`,
    async read(asOf) {
      const accounts = await call(
        "account.account",
        { domain: [], fields: ["id", "code"] },
        Account,
      );
      const codeById = new Map(accounts.map((a) => [a.id, a.code || ""]));
      // A cash line can be posted from any journal: the balance belongs to the account,
      // and the bank journal whose default account it is names it (measured 2026-09-20).
      const journals = await call(
        "account.journal",
        { domain: [["type", "=", "bank"]], fields: ["id", "name", "default_account_id"] },
        BankJournal,
      );
      const journalByAccount = new Map(
        journals.flatMap((j) =>
          j.default_account_id === false ? [] : [[j.default_account_id[0], j] as const],
        ),
      );
      const sums = new Map<string, { line: Omit<BalanceLine, "amount">; values: string[] }>();
      const add = (line: Omit<BalanceLine, "amount">, value: number, negate: boolean) => {
        const key = `${line.odooCompanyId}:${line.kind}:${line.odooPartnerId}:${line.odooJournalId}`;
        const amount = decimal(String(value));
        const entry = sums.get(key) ?? { line, values: [] };
        entry.values.push((negate ? neg(amount) : amount).toString());
        sums.set(key, entry);
      };
      let offset = 0;
      for (;;) {
        const page = await call(
          "account.move.line",
          {
            domain: [
              ["parent_state", "=", "posted"],
              ["date", "<=", asOf],
            ],
            fields: MOVE_LINE_FIELDS,
            limit: PAGE,
            offset,
            order: "id asc",
          },
          MoveLine,
        );
        for (const line of page) {
          const accountId = line.account_id === false ? null : line.account_id[0];
          const code = accountId === null ? "" : (codeById.get(accountId) ?? "");
          const entity = line.company_id === false ? "" : line.company_id[1];
          const odooCompanyId = line.company_id === false ? null : line.company_id[0];
          const partner = line.partner_id === false ? null : line.partner_id;
          const base = { entity, odooCompanyId, odooPartnerId: null, odooJournalId: null };
          if (line.account_type === "asset_cash" && line.account_id !== false) {
            const journal = journalByAccount.get(line.account_id[0]);
            add(
              {
                ...base,
                kind: "bank",
                reference: journal?.name ?? line.account_id[1],
                odooJournalId: journal?.id ?? null,
              },
              line.balance,
              false,
            );
          } else if (code.startsWith(prefixes.receivable)) {
            add(
              {
                ...base,
                kind: "tenant",
                reference: partner ? partner[1] : "(sans tiers)",
                odooPartnerId: partner ? partner[0] : null,
              },
              line.balance,
              false,
            );
          } else if (code.startsWith(prefixes.cca)) {
            add(
              {
                ...base,
                kind: "cca",
                reference: partner ? partner[1] : "(sans tiers)",
                odooPartnerId: partner ? partner[0] : null,
              },
              line.balance,
              true,
            );
          } else if (code.startsWith(prefixes.deposit)) {
            add({ ...base, kind: "deposit", reference: "dépôts de garantie" }, line.balance, true);
          } else if (code.startsWith(prefixes.loan)) {
            add({ ...base, kind: "loan", reference: "emprunts" }, line.balance, true);
          } else if (code.startsWith(prefixes.asset) || code.startsWith(prefixes.depreciation)) {
            add({ ...base, kind: "nbv", reference: "valeur nette comptable" }, line.balance, false);
          }
        }
        if (page.length < PAGE) break;
        offset += PAGE;
      }
      return {
        asOf,
        source: `Odoo ${client.baseUrl} (account.move.line comptabilisées au ${asOf})`,
        lines: [...sums.values()].map(({ line, values }) => ({
          ...line,
          amount: toMoney(sum(values.map((v) => decimal(v)))),
        })),
      };
    },
  };
}

const KINDS: Record<string, BalanceKind> = {
  locataire: "tenant",
  tenant: "tenant",
  depot: "deposit",
  deposit: "deposit",
  pret: "loan",
  emprunt: "loan",
  loan: "loan",
  cca: "cca",
  banque: "bank",
  bank: "bank",
  vnc: "nbv",
  nbv: "nbv",
};

/** The accountant's balance export: one line per entity, nature and third party. */
export function createCsvLedger(path: string, mappingVersion = "balances-fr-v1"): LedgerReader {
  return {
    label: path,
    async read(asOf) {
      const mapping = resolveMapping(mappingVersion);
      const text = await readCsvFile(path, "spreadsheet");
      let table: ReturnType<typeof parseCsv>;
      try {
        table = parseCsv(text);
      } catch (error) {
        if (error instanceof CsvError)
          throw new SourceUnreachable("spreadsheet", `${path} : ${error.message}`);
        throw error;
      }
      const mapped = mapTable(mapping, table);
      if (mapped.missingColumns.length > 0) {
        throw new SourceUnreachable(
          "spreadsheet",
          `${path} : colonnes absentes ${mapped.missingColumns.join(", ")}`,
        );
      }
      const lines: BalanceLine[] = [];
      for (const row of mapped.rows) {
        const rawKind = row.values.get("kind") ?? "";
        const kind = KINDS[nameKey(rawKind).replace(/ /g, "")];
        const amount = parseMoney(row.values.get("amount") ?? "", mapping.decimalMark);
        if (!kind || amount === null) {
          throw new SourceUnreachable(
            "spreadsheet",
            `${path} ligne ${row.line} : nature « ${rawKind} » ou solde illisible`,
          );
        }
        lines.push({
          entity: row.values.get("entity") ?? "",
          odooCompanyId: null,
          kind,
          reference: row.values.get("reference") ?? "",
          odooPartnerId: null,
          odooJournalId: null,
          amount,
        });
      }
      return { asOf, source: path, lines };
    },
  };
}

function lineKey(line: BalanceLine): string {
  return `${nameKey(line.entity)}|${line.kind}|${line.kind === "tenant" || line.kind === "cca" || line.kind === "bank" ? nameKey(line.reference) : ""}`;
}

function idKey(line: BalanceLine): string | null {
  if (line.odooCompanyId === null) return null;
  if (line.kind === "tenant" || line.kind === "cca") {
    return line.odooPartnerId === null
      ? null
      : `${line.odooCompanyId}|${line.kind}|p${line.odooPartnerId}`;
  }
  if (line.kind === "bank") {
    return line.odooJournalId === null ? null : `${line.odooCompanyId}|bank|j${line.odooJournalId}`;
  }
  return `${line.odooCompanyId}|${line.kind}`;
}

/** Never corrects anything: every pair is listed with its difference, unmatched lines included. */
export function compareBalances(
  organizationId: string,
  app: BalanceSet,
  ledger: BalanceSet,
): BalanceReport {
  const lines: BalanceDifference[] = [];
  const consumed = new Set<number>();
  for (const line of app.lines) {
    const byId = idKey(line);
    let index =
      byId === null ? -1 : ledger.lines.findIndex((l, i) => !consumed.has(i) && idKey(l) === byId);
    let matchedOn: BalanceDifference["matchedOn"] = index === -1 ? "none" : "odoo_id";
    if (index === -1) {
      index = ledger.lines.findIndex((l, i) => !consumed.has(i) && lineKey(l) === lineKey(line));
      if (index !== -1) matchedOn = "name";
    }
    const other = index === -1 ? null : (ledger.lines[index] ?? null);
    if (index !== -1) consumed.add(index);
    lines.push({
      entity: line.entity,
      kind: line.kind,
      reference: line.reference,
      app: line.amount,
      ledger: other?.amount ?? null,
      difference: toMoney(decimal(line.amount).minus(decimal(other?.amount ?? "0"))),
      matchedOn,
    });
  }
  ledger.lines.forEach((line, index) => {
    if (consumed.has(index)) return;
    lines.push({
      entity: line.entity,
      kind: line.kind,
      reference: line.reference,
      app: null,
      ledger: line.amount,
      difference: toMoney(neg(decimal(line.amount))),
      matchedOn: "none",
    });
  });
  const different = lines.filter((line) => line.difference !== "0.00").length;
  const blockers: string[] = [];
  if (ledger.lines.length === 0) {
    blockers.push(
      `${ledger.source} : aucun solde lu — extraction défaillante, la bascule est bloquée (MIG-02)`,
    );
  }
  if (ledger.lines.length > 0 && ledger.lines.every((line) => line.amount === "0.00")) {
    blockers.push(
      `${ledger.source} : tous les soldes valent 0,00 — extraction défaillante, la bascule est bloquée (MIG-02)`,
    );
  }
  return {
    asOf: app.asOf,
    organizationId,
    appSource: app.source,
    ledgerSource: ledger.source,
    lines,
    equal: lines.length - different,
    different,
    blockers,
  };
}

export function renderBalances(
  report: BalanceReport,
  table: (h: string[], r: string[][]) => string,
): string {
  const out = [
    `Soldes d’ouverture au ${report.asOf} — organisation ${report.organizationId}`,
    `application : ${report.appSource}`,
    `grand livre : ${report.ledgerSource}`,
    "",
    table(
      ["société", "nature", "référence", "application", "grand livre", "écart", "rapproché sur"],
      report.lines.map((line) => [
        line.entity,
        line.kind,
        line.reference,
        line.app ?? "—",
        line.ledger ?? "—",
        line.difference,
        line.matchedOn,
      ]),
    ),
    "",
    `${report.equal} solde(s) identique(s), ${report.different} écart(s). Rien n’a été corrigé : ce rapport est celui que le propriétaire et l’expert-comptable signent.`,
  ];
  for (const blocker of report.blockers) out.push(`  ✗ ${blocker}`);
  return out.join("\n");
}
