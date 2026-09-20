import { decimal, sum, toMoney } from "@lfsci/domain";
import postgres from "postgres";
import type {
  AssetRecord,
  BankLineRecord,
  CcaMovementRecord,
  DepositMovementRecord,
  ExpenseRecord,
  LoanMovementRecord,
  LoanRecord,
  PersonRecord,
  PersonRole,
  Rejection,
  RentTermRecord,
  SourceRead,
  SourceReader,
  SourceRecord,
  SupplierRecord,
} from "../model";
import { SourceUnreachable } from "../model";

/**
 * Chart of the SCI as measured on the restored copy (2026-09-20): rents and charge
 * provisions are recognised on receipt, straight from the bank statement, so the
 * facts live on the counterpart lines and not on invoices.
 */
export const COPY_ACCOUNTS = {
  rent: "706003",
  charges: "706004",
  deposit: "165500",
  cca: "455100",
  loan: "164000",
  loanInterest: "661600",
  bank: "512001",
  suspense: "512002",
};

const DEPRECIATION_PREFIX = "68";

export type OdooCopyOptions = {
  url: string;
  accounts?: Partial<typeof COPY_ACCOUNTS>;
  now?: () => Date;
};

export type CopySql = postgres.TransactionSql;

type Company = {
  id: number;
  name: string;
  partner_id: number | null;
  fiscalyear_lock_date: string | null;
  hard_lock_date: string | null;
};

type Partner = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  vat: string | null;
  active: boolean;
};

export type CopyLine = {
  id: number;
  move_id: number;
  move_name: string;
  parent_state: string;
  date: string;
  debit: string;
  credit: string;
  partner_id: number | null;
  partner_name: string | null;
  statement_line_id: number | null;
  company_id: number;
  account_id: number;
  code: string;
  account_type: string;
  label: string | null;
};

type StatementLine = {
  id: number;
  date: string;
  amount: string;
  payment_ref: string | null;
  journal_id: number;
  journal: string;
  company_id: number;
  is_reconciled: boolean;
};

type Asset = {
  id: number;
  name: string;
  state: string;
  original_value: string;
  book_value: string;
  acquisition_date: string | null;
  company_id: number;
};

/** Every read runs in one read-only, repeatable-read transaction: a consistent snapshot, no write possible. */
export async function withCopy<T>(url: string, work: (sql: CopySql) => Promise<T>): Promise<T> {
  let sql: postgres.Sql;
  try {
    sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  } catch (error) {
    throw unreachable(error);
  }
  try {
    const result = await sql.begin("isolation level repeatable read read only", async (tx) => ({
      value: await work(tx),
    }));
    return result.value;
  } catch (error) {
    throw unreachable(error);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function unreachable(error: unknown): SourceUnreachable {
  if (error instanceof SourceUnreachable) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SourceUnreachable("odoo_copy", `Copie Odoo : ${message}`, { cause: error });
}

export function monthBounds(date: string): { start: string; end: string } {
  const [year, month] = date.split("-").map(Number);
  if (year === undefined || month === undefined) return { start: date, end: date };
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${String(last).padStart(2, "0")}` };
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function wire(value: string): string {
  return toMoney(decimal(value));
}

const REJECT = (
  kind: Rejection["kind"],
  line: CopyLine,
  reason: Rejection["reason"],
  detail: string,
): Rejection => ({
  source: "odoo_copy",
  kind,
  ref: `account.move.line:${line.id}`,
  reason,
  detail: `${line.move_name} du ${line.date} : ${detail}`,
});

export type NettedReceipt = { credit: CopyLine; amount: string };
export type NettedTerm = {
  credit: CopyLine;
  amount: string;
  netted: CopyLine[];
  receipts: NettedReceipt[];
};

/**
 * One term per partner, month and account (the schema allows one term per lease,
 * kind and month); each credit of the month is a receipt on it. Debits of the
 * same month reduce the receipts in date order. A debit larger than the month's
 * credits is left over and reported by the caller.
 */
export function netRentLines(lines: CopyLine[]): { terms: NettedTerm[]; leftover: CopyLine[] } {
  const groups = new Map<string, CopyLine[]>();
  for (const line of lines) {
    const key = `${line.account_id}:${line.partner_id}:${line.date.slice(0, 7)}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(line);
    groups.set(key, bucket);
  }
  const terms: NettedTerm[] = [];
  const leftover: CopyLine[] = [];
  for (const bucket of groups.values()) {
    const ordered = [...bucket].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const credits = ordered.filter((line) => decimal(line.credit).gt(0));
    const debits = ordered.filter((line) => decimal(line.debit).gt(0));
    let remaining = sum(debits.map((line) => decimal(line.debit)));
    const nettedBy: CopyLine[] = remaining.isZero() ? [] : debits;
    const receipts: NettedReceipt[] = [];
    for (const credit of credits) {
      const gross = decimal(credit.credit);
      const taken = remaining.gt(gross) ? gross : remaining;
      remaining = remaining.minus(taken);
      receipts.push({ credit, amount: toMoney(gross.minus(taken)) });
    }
    const first = credits[0];
    if (first) {
      terms.push({
        credit: first,
        amount: toMoney(sum(receipts.map((receipt) => decimal(receipt.amount)))),
        netted: nettedBy,
        receipts,
      });
    }
    if (remaining.gt(0)) leftover.push(...debits);
  }
  const byDate = (a: CopyLine, b: CopyLine) => a.date.localeCompare(b.date) || a.id - b.id;
  terms.sort((a, b) => byDate(a.credit, b.credit));
  leftover.sort(byDate);
  return { terms, leftover };
}

export function inferRoles(
  partnerId: number,
  lines: CopyLine[],
  accounts: typeof COPY_ACCOUNTS,
): PersonRole[] {
  const roles = new Set<PersonRole>();
  for (const line of lines) {
    if (line.partner_id !== partnerId) continue;
    if (line.code === accounts.rent || line.code === accounts.charges) roles.add("tenant");
    else if (line.code === accounts.cca) roles.add("associate");
    else if (line.code === accounts.loan || line.code === accounts.loanInterest)
      roles.add("lender");
    else if (isExpenseCode(line, accounts)) roles.add("supplier");
  }
  return [...roles].sort();
}

function isExpenseCode(line: CopyLine, accounts: typeof COPY_ACCOUNTS): boolean {
  return (
    line.account_type === "expense" &&
    line.code !== accounts.loanInterest &&
    !line.code.startsWith(DEPRECIATION_PREFIX)
  );
}

export async function readCompanies(sql: CopySql): Promise<Company[]> {
  const rows = await sql<Company[]>`
    SELECT id, name, partner_id, fiscalyear_lock_date::text, hard_lock_date::text
      FROM res_company ORDER BY id`;
  return rows.map((row) => ({
    ...row,
    fiscalyear_lock_date: row.fiscalyear_lock_date ? isoDate(row.fiscalyear_lock_date) : null,
    hard_lock_date: row.hard_lock_date ? isoDate(row.hard_lock_date) : null,
  }));
}

export async function readPartners(sql: CopySql): Promise<Partner[]> {
  return sql<Partner[]>`
    SELECT id, name, email, phone, vat, active FROM res_partner ORDER BY id`;
}

/** Odoo 19 keeps the account code per company in `code_store` and translates names in jsonb. */
export async function readPostedLines(sql: CopySql, companyId: number): Promise<CopyLine[]> {
  const rows = await sql<CopyLine[]>`
    SELECT l.id, l.move_id, m.name AS move_name, l.parent_state, l.date::text,
           l.debit::text, l.credit::text, l.partner_id, p.name AS partner_name,
           l.statement_line_id, l.company_id, l.account_id,
           a.code_store->>${String(companyId)} AS code, a.account_type, l.name AS label
      FROM account_move_line l
      JOIN account_move m ON m.id = l.move_id
      JOIN account_account a ON a.id = l.account_id
      LEFT JOIN res_partner p ON p.id = l.partner_id
     WHERE l.parent_state = 'posted' AND l.company_id = ${companyId}
     ORDER BY l.date, l.id`;
  return rows.map((row) => ({ ...row, date: isoDate(row.date), code: row.code ?? "" }));
}

export async function readStatementLines(
  sql: CopySql,
  companyId: number,
): Promise<StatementLine[]> {
  const rows = await sql<StatementLine[]>`
    SELECT s.id, m.date::text, s.amount::text, s.payment_ref, s.journal_id,
           COALESCE(j.name->>'en_US', j.code) AS journal, s.company_id, s.is_reconciled
      FROM account_bank_statement_line s
      JOIN account_move m ON m.id = s.move_id
      JOIN account_journal j ON j.id = s.journal_id
     WHERE m.state = 'posted' AND s.company_id = ${companyId}
     ORDER BY m.date, s.id`;
  return rows.map((row) => ({ ...row, date: isoDate(row.date) }));
}

export async function readAssets(sql: CopySql, companyId: number): Promise<Asset[]> {
  const rows = await sql<Asset[]>`
    SELECT id, name, state, original_value::text, book_value::text, acquisition_date::text, company_id
      FROM account_asset
     WHERE company_id = ${companyId} AND state IN ('open', 'close', 'paused')
     ORDER BY id`;
  return rows.map((row) => ({
    ...row,
    acquisition_date: row.acquisition_date ? isoDate(row.acquisition_date) : null,
  }));
}

function movementOf(
  line: CopyLine,
  entity: string,
): Omit<LoanMovementRecord, "kind" | "direction"> {
  const amount = decimal(line.credit).gt(0) ? line.credit : line.debit;
  return {
    source: "odoo_copy",
    ref: `account.move.line:${line.id}`,
    entity,
    odooCompanyId: line.company_id,
    partnerName: line.partner_name ?? "",
    odooPartnerId: line.partner_id ?? 0,
    occurredOn: line.date,
    amount: wire(amount),
    odooMoveId: line.move_id,
    odooMoveName: line.move_name,
    odooStatementLineId: line.statement_line_id,
  };
}

export function mapLines(
  lines: CopyLine[],
  entity: string,
  accounts: typeof COPY_ACCOUNTS,
): { records: SourceRecord[]; rejections: Rejection[]; notes: string[] } {
  const records: SourceRecord[] = [];
  const rejections: Rejection[] = [];
  const rentLines = lines.filter(
    (line) => line.code === accounts.rent || line.code === accounts.charges,
  );
  const withPartner = rentLines.filter((line) => line.partner_id !== null);
  for (const line of rentLines) {
    if (line.partner_id === null) {
      rejections.push(
        REJECT("rent_term", line, "missing_field", "encaissement sans locataire sur le compte"),
      );
    }
  }
  const netted = netRentLines(withPartner);
  for (const term of netted.terms) {
    const { credit } = term;
    const bounds = monthBounds(credit.date);
    if (decimal(term.amount).isZero()) {
      rejections.push(
        REJECT(
          "rent_term",
          credit,
          "invalid_money",
          "encaissement entièrement annulé par un remboursement du même mois",
        ),
      );
      continue;
    }
    const record: RentTermRecord = {
      source: "odoo_copy",
      kind: "rent_term",
      ref: `account.move.line:${credit.id}`,
      entity,
      odooCompanyId: credit.company_id,
      partnerName: credit.partner_name ?? "",
      odooPartnerId: credit.partner_id ?? 0,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      dueOn: credit.date,
      total: term.amount,
      residual: "0.00",
      settled: true,
      component: credit.code === accounts.rent ? "rent" : "charges",
      odooMoveId: credit.move_id,
      odooMoveName: credit.move_name,
      odooStatementLineId: credit.statement_line_id,
      nettedRefs: term.netted.map((line) => `account.move.line:${line.id}`),
      receipts: term.receipts
        .filter((receipt) => !decimal(receipt.amount).isZero())
        .map((receipt) => ({
          ref: `account.move.line:${receipt.credit.id}`,
          amount: receipt.amount,
          receivedOn: receipt.credit.date,
          odooMoveName: receipt.credit.move_name,
          odooStatementLineId: receipt.credit.statement_line_id,
        })),
    };
    records.push(record);
  }
  for (const line of netted.leftover) {
    rejections.push(
      REJECT(
        "rent_term",
        line,
        "unsupported",
        "remboursement sans encaissement du même mois à compenser : à saisir à la main",
      ),
    );
  }

  for (const line of lines) {
    if (!isExpenseCode(line, accounts)) continue;
    if (line.partner_id === null) {
      rejections.push(REJECT("expense", line, "missing_field", "dépense sans fournisseur"));
      continue;
    }
    if (!decimal(line.debit).gt(0)) {
      rejections.push(
        REJECT("expense", line, "unsupported", "avoir fournisseur (crédit sur compte de charge)"),
      );
      continue;
    }
    const record: ExpenseRecord = {
      source: "odoo_copy",
      kind: "expense",
      ref: `account.move.line:${line.id}`,
      entity,
      odooCompanyId: line.company_id,
      supplierName: line.partner_name ?? "",
      odooPartnerId: line.partner_id,
      issuedOn: line.date,
      totalInclTax: wire(line.debit),
      residual: "0.00",
      paid: true,
      odooMoveId: line.move_id,
      odooMoveName: line.move_name,
    };
    records.push(record);
  }

  for (const line of lines) {
    const kind =
      line.code === accounts.deposit
        ? "deposit_movement"
        : line.code === accounts.cca
          ? "cca_movement"
          : line.code === accounts.loan || line.code === accounts.loanInterest
            ? "loan_movement"
            : null;
    if (kind === null) continue;
    if (line.partner_id === null) {
      rejections.push(REJECT(kind, line, "missing_field", "mouvement sans tiers"));
      continue;
    }
    const credit = decimal(line.credit).gt(0);
    const base = movementOf(line, entity);
    if (kind === "deposit_movement") {
      const record: DepositMovementRecord = {
        ...base,
        kind,
        direction: credit ? "received" : "returned",
      };
      records.push(record);
    } else if (kind === "cca_movement") {
      const record: CcaMovementRecord = {
        ...base,
        kind,
        direction: credit ? "contribution" : "repayment",
      };
      records.push(record);
    } else {
      const record: LoanMovementRecord = {
        ...base,
        kind,
        direction:
          line.code === accounts.loanInterest ? "interest" : credit ? "drawdown" : "repayment",
      };
      records.push(record);
    }
  }

  const loans = records.filter(
    (r): r is LoanMovementRecord => r.kind === "loan_movement" && r.direction === "drawdown",
  );
  for (const drawdown of loans) {
    const repayments = records.filter(
      (r): r is LoanMovementRecord =>
        r.kind === "loan_movement" &&
        r.direction === "repayment" &&
        r.odooPartnerId === drawdown.odooPartnerId &&
        r.occurredOn >= drawdown.occurredOn,
    );
    const repaid = sum(repayments.map((r) => decimal(r.amount)));
    const last = repayments[repayments.length - 1];
    const loan: LoanRecord = {
      source: "odoo_copy",
      kind: "loan",
      ref: drawdown.ref,
      entity,
      odooCompanyId: drawdown.odooCompanyId,
      reference: drawdown.odooMoveName,
      lender: drawdown.partnerName,
      principal: drawdown.amount,
      releasedOn: drawdown.occurredOn,
      durationMonths: null,
      nominalRate: null,
      outstanding: last ? toMoney(decimal(drawdown.amount).minus(repaid)) : null,
      outstandingOn: last ? last.occurredOn : null,
    };
    records.push(loan);
  }

  const suspense = lines.filter((line) => line.code === accounts.suspense);
  const suspenseBalance = sum(
    suspense.map((line) => decimal(line.debit).minus(decimal(line.credit))),
  );
  const depreciation = lines.filter((l) => l.code.startsWith(DEPRECIATION_PREFIX)).length;
  const notes = [
    `loyers : ${netted.terms.length} encaissement(s) sur ${accounts.rent}/${accounts.charges}, ${netted.terms.filter((t) => t.netted.length > 0).length} réduit(s) par un remboursement du même mois, ${rentLines.length - withPartner.length} sans locataire`,
    `compte d’attente ${accounts.suspense} : ${suspense.length} ligne(s), solde ${toMoney(suspenseBalance)}${suspenseBalance.isZero() ? "" : " — à lettrer dans Odoo avant la bascule"}`,
    `amortissements (${DEPRECIATION_PREFIX}xxxx) : ${depreciation} ligne(s) comptabilisée(s), non reprises (la VNC vient de account_asset)`,
  ];
  return { records, rejections, notes };
}

export function createOdooCopySource(options: OdooCopyOptions): SourceReader {
  const accounts = { ...COPY_ACCOUNTS, ...options.accounts };
  const now = options.now ?? (() => new Date());
  const host = (() => {
    try {
      const url = new URL(options.url);
      return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
    } catch {
      return options.url;
    }
  })();

  return {
    name: "odoo_copy",
    async read(): Promise<SourceRead> {
      const readAt = now().toISOString();
      return withCopy(options.url, async (sql) => {
        const companies = await readCompanies(sql);
        const company = companies[0];
        if (!company || companies.length !== 1) {
          throw new SourceUnreachable(
            "odoo_copy",
            `Copie Odoo ${host} : ${companies.length} société(s) dans res_company, une seule attendue`,
          );
        }
        const partners = await readPartners(sql);
        const lines = await readPostedLines(sql, company.id);
        const statementLines = await readStatementLines(sql, company.id);
        const assets = await readAssets(sql, company.id);

        const records: SourceRecord[] = [];
        let skipped = 0;
        for (const partner of partners) {
          if (partner.id === company.partner_id) {
            skipped += 1;
            continue;
          }
          const roles = inferRoles(partner.id, lines, accounts);
          if (roles.length === 0) {
            skipped += 1;
            continue;
          }
          const ref = `res.partner:${partner.id}`;
          if (roles.includes("supplier")) {
            const supplier: SupplierRecord = {
              source: "odoo_copy",
              kind: "supplier",
              ref,
              name: partner.name,
              vat: partner.vat,
              odooPartnerId: partner.id,
            };
            records.push(supplier);
          }
          if (roles.some((role) => role !== "supplier")) {
            const person: PersonRecord = {
              source: "odoo_copy",
              kind: "person",
              ref,
              displayName: partner.name,
              roles,
              email: partner.email,
              phone: partner.phone,
              odooPartnerId: partner.id,
            };
            records.push(person);
          }
        }

        const mapped = mapLines(lines, company.name, accounts);
        records.push(...mapped.records);
        for (const line of statementLines) {
          const record: BankLineRecord = {
            source: "odoo_copy",
            kind: "bank_line",
            ref: `account.bank.statement.line:${line.id}`,
            entity: company.name,
            odooCompanyId: line.company_id,
            journal: line.journal,
            odooJournalId: line.journal_id,
            date: line.date,
            amount: wire(line.amount),
            label: line.payment_ref ?? "",
          };
          records.push(record);
        }
        for (const asset of assets) {
          const record: AssetRecord = {
            source: "odoo_copy",
            kind: "asset",
            ref: `account.asset:${asset.id}`,
            entity: company.name,
            odooCompanyId: asset.company_id,
            label: asset.name,
            grossValue: wire(asset.original_value),
            accumulatedDepreciation: toMoney(
              decimal(asset.original_value).minus(decimal(asset.book_value)),
            ),
            netBookValue: wire(asset.book_value),
            commissionedOn: asset.acquisition_date,
            odooAssetId: asset.id,
          };
          records.push(record);
        }

        const dates = [...lines.map((l) => l.date), ...statementLines.map((l) => l.date)].sort();
        const persons = records.filter((r) => r.kind === "person").length;
        const suppliers = records.filter((r) => r.kind === "supplier").length;
        const notes = [
          `société : ${company.name} (Odoo ${company.id}), exercice verrouillé au ${company.fiscalyear_lock_date ?? "— (aucun)"}, verrou définitif ${company.hard_lock_date ?? "aucun"}`,
          `partenaires : ${partners.length} lus, ${persons} personne(s) et ${suppliers} fournisseur(s) déduits des comptes mouvementés, ${skipped} sans rôle ignorés`,
          `écritures : ${lines.length} lignes comptabilisées lues, aucune facture — les loyers sont reconnus à l’encaissement`,
          `banque : ${statementLines.length} lignes de relevé, ${statementLines.filter((l) => !l.is_reconciled).length} non lettrée(s)`,
          `immobilisations : ${assets.length} lues dans account_asset (modèles et annulées exclus)`,
          ...mapped.notes,
        ];
        return {
          source: "odoo_copy",
          label: `Copie Odoo ${host}`,
          found: partners.length + lines.length + statementLines.length + assets.length,
          records,
          rejections: mapped.rejections,
          notes,
          coverage: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
          readAt,
        };
      });
    },
  };
}
