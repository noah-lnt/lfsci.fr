/**
 * Phase 0 probe: drives a local Odoo 18 Community + OCA through the real connector.
 * Run: npx tsx --env-file-if-exists=.env scripts/odoo-poc/run.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAppError, redactValue, runWithCorrelation } from "@lfsci/kernel";
import type { CapabilitySnapshot, ExchangeRecord, OdooClient, OdooOperations } from "@lfsci/odoo";
import {
  createOdooClient,
  createOdooOperations,
  fetchCapabilitySnapshot,
  newOperationRef,
} from "@lfsci/odoo";
import { buildCamt053 } from "./camt";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");

const IBAN = "FR7630006000011234567890189";
const TENANT_NAME = "Camille Martin";
const TENANT_REF = "LFSCI-TENANT-0001";

type StepStatus = "PASS" | "FAIL" | "UNKNOWN";

/** The call went through, but Odoo did something other than what the design assumed. */
class Divergence extends Error {}

type StepResult = {
  id: string;
  title: string;
  status: StepStatus;
  durationMs: number;
  detail: string;
  surface: string[];
  data?: Record<string, unknown>;
};

type Ctx = {
  client: OdooClient;
  ops: OdooOperations;
  surface: string[];
  capability: CapabilitySnapshot | null;
  companyId: number;
  journalId: number;
  saleJournalId: number;
  rentAccountId: number;
  provisionAccountId: number;
  partnerId: number;
  invoiceId: number;
  invoiceName: string;
  statementLineIds: number[];
  secondInvoiceId: number;
  miscJournalId: number;
  receivableAccountId: number;
  lockShiftedTo: string;
  callsPerSecond: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} manquant : renseignez-le dans .env`);
  return value;
}

function describe(error: unknown): string {
  if (!isAppError(error)) return error instanceof Error ? error.message : String(error);
  const odoo = error.details?.odoo;
  const message =
    odoo && typeof odoo === "object" && "message" in odoo ? String(odoo.message) : error.message;
  return `${error.code}: ${message.slice(0, 220)}`;
}

async function main(): Promise<void> {
  const exchanges: ExchangeRecord[] = [];
  const client = createOdooClient({
    baseUrl: requireEnv("ODOO_BASE_URL"),
    apiKey: requireEnv("ODOO_API_KEY"),
    database: requireEnv("ODOO_DATABASE"),
    login: process.env.ODOO_LOGIN ?? "",
    transport: process.env.ODOO_TRANSPORT === "json2" ? "json2" : "jsonrpc",
    // The local instance is ours: the 1 req/s production budget would only slow the probe.
    ratePerSecond: Number(process.env.ODOO_POC_RATE ?? 0),
    recorder: { record: (exchange) => void exchanges.push(exchange) },
  });

  const ctx = {
    client,
    ops: createOdooOperations(client),
    surface: [],
    capability: null,
    statementLineIds: [],
  } as unknown as Ctx;

  const steps: { id: string; title: string; run: (ctx: Ctx) => Promise<string> }[] = [
    { id: "a", title: "authenticate + capability snapshot", run: stepCapability },
    { id: "b", title: "create the tenant partner", run: stepPartner },
    { id: "c", title: "post a rent invoice (700 + 80)", run: stepInvoice },
    { id: "d", title: "attach a PDF to the move", run: stepAttachment },
    { id: "e", title: "import a CAMT.053 with two transactions", run: stepCamt },
    { id: "f", title: "reconcile the 780 line against the invoice", run: stepReconcile },
    { id: "g", title: "partial payment: 900 invoice, 500 received", run: stepPartial },
    { id: "h", title: "lost response resolved by operation reference", run: stepLostResponse },
    { id: "i", title: "closed period refuses a backdated posting", run: stepLockedPeriod },
    { id: "j", title: "sustained read throughput (100 search_read)", run: stepThroughput },
  ];

  const results: StepResult[] = [];
  for (const step of steps) {
    ctx.surface = [];
    const startedAt = Date.now();
    let status: StepStatus = "PASS";
    let detail: string;
    try {
      detail = await runWithCorrelation({}, () => step.run(ctx));
    } catch (error) {
      if (error instanceof Divergence) {
        status = "UNKNOWN";
      } else {
        status = isAppError(error) && error.code === "RESULT_UNKNOWN" ? "UNKNOWN" : "FAIL";
      }
      detail = describe(error);
    }
    results.push({
      id: step.id,
      title: step.title,
      status,
      durationMs: Date.now() - startedAt,
      detail,
      surface: [...ctx.surface],
    });
    const line = `${status.padEnd(7)} ${step.id}  ${step.title}`;
    process.stdout.write(
      `${line.padEnd(66)} ${String(Date.now() - startedAt).padStart(6)} ms  ${detail}\n`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        baseUrl: client.baseUrl,
        database: client.database,
        transport: client.transport,
        results,
        capability: redactValue({
          source: ctx.capability?.source,
          models: ctx.capability?.models,
        }),
        exchanges: redactValue(exchanges),
      },
      null,
      2,
    ),
  );
  process.stdout.write(`\nraw payloads: ${file}\n`);

  const failed = results.filter((result) => result.status === "FAIL");
  process.exitCode = failed.length === 0 ? 0 : 1;
}

function surface(ctx: Ctx, model: string, method: string, note = ""): void {
  ctx.surface.push(`${model}.${method}${note ? ` (${note})` : ""}`);
}

async function stepCapability(ctx: Ctx): Promise<string> {
  surface(ctx, "common", "authenticate", "uid then execute_kw");
  surface(ctx, "<model>", "fields_get", "no /doc before Odoo 19; ir.model needs Access Rights");
  const snapshot = await fetchCapabilitySnapshot(ctx.client);
  ctx.capability = snapshot;
  ctx.ops = createOdooOperations(ctx.client, { capability: snapshot });

  const models = Object.keys(snapshot.models ?? {});
  const refField = ctx.ops.operationRefField;
  const carriers = models.filter((model) => snapshot.models?.[model]?.fields?.includes(refField));

  const company = await ctx.client.call<{ id: number; currency_id: [number, string] }[]>(
    "res.company",
    "search_read",
    { domain: [], fields: ["id", "name", "currency_id"], limit: 1 },
    { idempotent: true },
  );
  ctx.companyId = company[0]?.id ?? 1;

  const journals = await ctx.ops.readJournals({ types: ["bank", "sale", "general"] });
  ctx.journalId = journals.find((journal) => journal.type === "bank")?.id ?? 0;
  ctx.saleJournalId = journals.find((journal) => journal.type === "sale")?.id ?? 0;
  ctx.miscJournalId = journals.find((journal) => journal.type === "general")?.id ?? 0;

  const accounts = await ctx.client.call<{ id: number; code: string }[]>(
    "account.account",
    "search_read",
    {
      domain: [["code", "in", ["708300", "706000", "411100"]]],
      fields: ["id", "code"],
      limit: 5,
    },
    { idempotent: true },
  );
  surface(ctx, "account.account", "search_read", "French chart codes 708300 / 706000");
  ctx.rentAccountId = accounts.find((account) => account.code === "708300")?.id ?? 0;
  ctx.provisionAccountId = accounts.find((account) => account.code === "706000")?.id ?? 0;
  ctx.receivableAccountId = accounts.find((account) => account.code === "411100")?.id ?? 0;

  return `${models.length} models, ${refField} on [${carriers.join(", ")}], bank journal ${ctx.journalId}`;
}

async function stepPartner(ctx: Ctx): Promise<string> {
  surface(ctx, "res.partner", "search_read");
  surface(ctx, "res.partner", "create", "vals_list positional over execute_kw");
  const existing = await ctx.ops.findPartnerByRef(TENANT_REF);
  if (existing) {
    ctx.partnerId = existing.id;
    return `reused partner ${existing.id}`;
  }
  const created = await ctx.ops.createPartner({
    name: TENANT_NAME,
    ref: TENANT_REF,
    email: "camille.martin@example.test",
  });
  ctx.partnerId = created.id;
  return `partner ${created.id}, operation ref ${created.operationRef}`;
}

async function postInvoice(
  ctx: Ctx,
  lines: { name: string; priceUnit: number; accountId: number }[],
  reference: string,
): Promise<{ id: number; name: string; amount: number }> {
  const created = await ctx.ops.createDraftCustomerInvoice({
    partnerId: ctx.partnerId,
    invoiceDate: new Date().toISOString().slice(0, 10),
    journalId: ctx.saleJournalId,
    ref: reference,
    lines: lines.map((line) => ({ ...line, taxIds: [] })),
  });
  await ctx.ops.postMove({ id: created.id });
  const moves = await ctx.client.call<{ id: number; name: string; amount_total: number }[]>(
    "account.move",
    "search_read",
    { domain: [["id", "=", created.id]], fields: ["id", "name", "amount_total"], limit: 1 },
    { idempotent: true },
  );
  const move = moves[0];
  return { id: created.id, name: move?.name ?? "", amount: move?.amount_total ?? 0 };
}

async function stepInvoice(ctx: Ctx): Promise<string> {
  surface(ctx, "account.move", "create", "invoice_line_ids as [0, 0, vals] triples");
  surface(ctx, "account.move", "action_post", "ids positional");
  const invoice = await postInvoice(
    ctx,
    [
      { name: "Loyer septembre", priceUnit: 700, accountId: ctx.rentAccountId },
      { name: "Provisions sur charges", priceUnit: 80, accountId: ctx.provisionAccountId },
    ],
    `LOYER-${Date.now()}`,
  );
  ctx.invoiceId = invoice.id;
  ctx.invoiceName = invoice.name;
  return `${invoice.name} for ${invoice.amount.toFixed(2)} EUR (708300 rent, 706000 provisions)`;
}

async function stepAttachment(ctx: Ctx): Promise<string> {
  surface(ctx, "ir.attachment", "create", "base64 in datas");
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
    "utf8",
  ).toString("base64");
  const attachment = await ctx.ops.attachDocument({
    name: `${ctx.invoiceName.replace(/\//g, "-")}.pdf`,
    base64: pdf,
    resModel: "account.move",
    resId: ctx.invoiceId,
    mimetype: "application/pdf",
  });
  return `attachment ${attachment.id} on account.move ${ctx.invoiceId}`;
}

async function importCamt(
  ctx: Ctx,
  filename: string,
  entries: Parameters<typeof buildCamt053>[0]["entries"],
): Promise<number[]> {
  surface(ctx, "account.statement.import", "create", "statement_file + statement_filename");
  surface(ctx, "account.statement.import", "import_file_button", "context journal_id");
  const xml = buildCamt053({
    messageId: `LFSCI-${Date.now()}`,
    statementId: filename,
    iban: IBAN,
    date: new Date().toISOString().slice(0, 10),
    balanceStart: 0,
    entries,
  });
  const wizardIds = await ctx.client.call<number[]>("account.statement.import", "create", {
    vals_list: [
      {
        statement_file: Buffer.from(xml, "utf8").toString("base64"),
        statement_filename: `${filename}.xml`,
      },
    ],
  });
  const wizardId = wizardIds[0];
  if (wizardId === undefined) throw new Error("wizard account.statement.import non créé");
  await ctx.client.call("account.statement.import", "import_file_button", {
    ids: [wizardId],
    context: { journal_id: ctx.journalId },
  });

  surface(ctx, "account.bank.statement.line", "search_read");
  const lines = await ctx.client.call<{ id: number }[]>(
    "account.bank.statement.line",
    "search_read",
    {
      domain: [["journal_id", "=", ctx.journalId]],
      fields: ["id", "payment_ref", "amount", "is_reconciled", "partner_id"],
      order: "id desc",
      limit: entries.length,
    },
    { idempotent: true },
  );
  return lines.map((line) => line.id);
}

async function stepCamt(ctx: Ctx): Promise<string> {
  const ids = await importCamt(ctx, `RENT-${Date.now()}`, [
    {
      amount: 780,
      date: new Date().toISOString().slice(0, 10),
      // Neither the invoice number nor the tenant IBAN: otherwise the OCA importer
      // auto-matches the line and step (f) would never reach the API.
      remittance: "VIR SEPA LOYER",
      endToEndId: `E2E-${Date.now()}-1`,
      partyName: "LOYER DIVERS",
    },
    {
      amount: -45.6,
      date: new Date().toISOString().slice(0, 10),
      remittance: "Prelevement assurance PNO",
      endToEndId: `E2E-${Date.now()}-2`,
      partyName: "Assureur Exemple",
    },
  ]);
  ctx.statementLineIds = ids;
  const rows = await ctx.client.call<{ id: number; amount: number; payment_ref: string }[]>(
    "account.bank.statement.line",
    "search_read",
    { domain: [["id", "in", ids]], fields: ["id", "amount", "payment_ref"] },
    { idempotent: true },
  );
  return rows.map((row) => `${row.id}:${row.amount}`).join(" ");
}

async function receivableLineId(ctx: Ctx, moveId: number): Promise<number> {
  surface(ctx, "account.move.line", "search_read", "receivable counterpart");
  const lines = await ctx.client.call<{ id: number }[]>(
    "account.move.line",
    "search_read",
    {
      domain: [
        ["move_id", "=", moveId],
        ["account_id.account_type", "=", "asset_receivable"],
      ],
      fields: ["id", "balance", "amount_residual"],
      limit: 1,
    },
    { idempotent: true },
  );
  const id = lines[0]?.id;
  if (id === undefined) throw new Error(`aucune ligne client sur account.move ${moveId}`);
  return id;
}

async function paymentState(ctx: Ctx, moveId: number): Promise<string> {
  const moves = await ctx.client.call<{ payment_state: string }[]>(
    "account.move",
    "search_read",
    { domain: [["id", "=", moveId]], fields: ["id", "payment_state", "amount_residual"] },
    { idempotent: true },
  );
  return moves[0]?.payment_state ?? "?";
}

async function stepReconcile(ctx: Ctx): Promise<string> {
  const rows = await ctx.client.call<{ id: number; amount: number; is_reconciled: boolean }[]>(
    "account.bank.statement.line",
    "search_read",
    { domain: [["id", "in", ctx.statementLineIds]], fields: ["id", "amount", "is_reconciled"] },
    { idempotent: true },
  );
  const target = rows.find((row) => Math.abs(row.amount - 780) < 0.01);
  if (!target) throw new Error("ligne de 780 introuvable");
  if (target.is_reconciled) throw new Error(`ligne ${target.id} déjà rapprochée à l'import`);

  surface(ctx, "account.bank.statement.line", "add_multiple_lines", "OCA widget step 1");
  surface(ctx, "account.bank.statement.line", "reconcile_bank_line", "OCA widget step 2");
  const moveLineId = await receivableLineId(ctx, ctx.invoiceId);
  await ctx.ops.reconcileBankLine({ statementLineId: target.id, moveLineIds: [moveLineId] });

  const state = await paymentState(ctx, ctx.invoiceId);
  if (state !== "paid") throw new Error(`payment_state=${state}, attendu paid`);
  const after = await ctx.client.call<{ is_reconciled: boolean }[]>(
    "account.bank.statement.line",
    "search_read",
    { domain: [["id", "=", target.id]], fields: ["id", "is_reconciled"] },
    { idempotent: true },
  );
  return `payment_state=paid on line ${target.id}; is_reconciled reads ${String(after[0]?.is_reconciled)}`;
}

async function stepPartial(ctx: Ctx): Promise<string> {
  const invoice = await postInvoice(
    ctx,
    [{ name: "Loyer octobre", priceUnit: 900, accountId: ctx.rentAccountId }],
    `LOYER-${Date.now()}-P`,
  );
  ctx.secondInvoiceId = invoice.id;
  const ids = await importCamt(ctx, `PART-${Date.now()}`, [
    {
      amount: 500,
      date: new Date().toISOString().slice(0, 10),
      // No name and no IBAN the reconcile models can latch on: this one needs a decision.
      remittance: "VIR SEPA ACOMPTE",
      endToEndId: `E2E-${Date.now()}-3`,
      partyName: "ACOMPTE DIVERS",
    },
  ]);
  const statementLineId = ids[0];
  if (statementLineId === undefined) throw new Error("ligne d'acompte non importée");
  surface(ctx, "account.bank.statement.line", "add_multiple_lines", "OCA widget step 1");
  surface(ctx, "account.bank.statement.line", "reconcile_bank_line", "OCA widget step 2");
  const moveLineId = await receivableLineId(ctx, invoice.id);
  await ctx.ops.reconcileBankLine({ statementLineId, moveLineIds: [moveLineId] });

  const state = await paymentState(ctx, invoice.id);
  if (state !== "partial") throw new Error(`payment_state=${state}, attendu partial`);
  return `${invoice.name} 900 EUR, 500 encaissés, payment_state=${state}`;
}

async function stepLostResponse(ctx: Ctx): Promise<string> {
  const operationRef = newOperationRef();
  const realFetch = globalThis.fetch;
  const dropping = createOdooClient({
    baseUrl: requireEnv("ODOO_BASE_URL"),
    apiKey: requireEnv("ODOO_API_KEY"),
    database: requireEnv("ODOO_DATABASE"),
    login: process.env.ODOO_LOGIN ?? "",
    transport: "jsonrpc",
    ratePerSecond: 0,
    timeoutMs: 2000,
    fetch: (async (input, init) => {
      const body = String(init?.body ?? "");
      const response = await realFetch(input, init);
      if (!body.includes("res.partner")) return response;
      await response.text();
      return new Promise<Response>((_resolve, reject) => {
        // AbortSignal.timeout unrefs its timer: hold the loop open until it fires.
        const guard = setTimeout(() => reject(new Error("drill: no abort")), 10_000);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(guard);
            reject(init.signal?.reason);
          },
          { once: true },
        );
      });
    }) as typeof globalThis.fetch,
  });
  const droppingOps = createOdooOperations(dropping, { capability: ctx.capability });

  let code = "none";
  try {
    await droppingOps.createPartner({
      name: `${TENANT_NAME} (drill)`,
      ref: `DRILL-${Date.now()}`,
      operationRef,
    });
  } catch (error) {
    code = isAppError(error) ? error.code : describe(error);
  }
  if (code !== "RESULT_UNKNOWN") throw new Error(`attendu RESULT_UNKNOWN, obtenu ${code}`);

  surface(ctx, "res.partner", "search_read", `domain on ${ctx.ops.operationRefField}`);
  const match = await ctx.ops.findByOperationRef(operationRef, { models: ["res.partner"] });
  if (match.kind !== "one") throw new Error(`findByOperationRef → ${match.kind}`);
  return `RESULT_UNKNOWN then resolved to res.partner ${match.id}`;
}

/** The bot is an Invoicing Administrator; only Access Rights may move a lock date. */
function adminClient(): OdooClient {
  return createOdooClient({
    baseUrl: requireEnv("ODOO_BASE_URL"),
    apiKey: requireEnv("ODOO_ADMIN_API_KEY"),
    database: requireEnv("ODOO_DATABASE"),
    login: requireEnv("ODOO_ADMIN_LOGIN"),
    transport: "jsonrpc",
    ratePerSecond: 0,
  });
}

async function stepLockedPeriod(ctx: Ctx): Promise<string> {
  surface(ctx, "res.company", "write", "fiscalyear_lock_date, admin credentials only");
  const lockDate = new Date();
  lockDate.setMonth(lockDate.getMonth() - 1);
  const lock = lockDate.toISOString().slice(0, 10);
  const backdated = new Date(lockDate);
  backdated.setDate(backdated.getDate() - 5);
  const backdatedAt = backdated.toISOString().slice(0, 10);

  const admin = adminClient();
  await admin.call("res.company", "write", {
    ids: [ctx.companyId],
    vals: { fiscalyear_lock_date: lock },
  });
  try {
    surface(ctx, "account.move", "create", "move_type=entry with an explicit date");
    surface(ctx, "account.move", "action_post");
    const entryIds = await ctx.client.call<number[]>("account.move", "create", {
      vals_list: [
        {
          move_type: "entry",
          journal_id: ctx.miscJournalId,
          date: backdatedAt,
          ref: "LFSCI phase 0 lock drill",
          line_ids: [
            [0, 0, { name: "drill", account_id: ctx.rentAccountId, credit: 100, debit: 0 }],
            [0, 0, { name: "drill", account_id: ctx.receivableAccountId, debit: 100, credit: 0 }],
          ],
        },
      ],
    });
    const id = entryIds[0];
    if (id === undefined) throw new Error("écriture de test non créée");
    await ctx.ops.postMove({ id });

    const posted = await ctx.client.call<{ date: string; state: string }[]>(
      "account.move",
      "search_read",
      { domain: [["id", "=", id]], fields: ["id", "date", "state"] },
      { idempotent: true },
    );
    const landedAt = posted[0]?.date ?? "?";
    ctx.lockShiftedTo = landedAt;
    throw new Divergence(
      `no refusal: lock ${lock}, entry asked for ${backdatedAt}, Odoo posted it at ${landedAt}`,
    );
  } catch (error) {
    if (error instanceof Divergence) throw error;
    const code = isAppError(error) ? error.code : "none";
    if (code !== "PERIOD_LOCKED")
      throw new Error(`attendu PERIOD_LOCKED, obtenu ${describe(error)}`);
    return `lock ${lock} → PERIOD_LOCKED on action_post`;
  } finally {
    await admin.call("res.company", "write", {
      ids: [ctx.companyId],
      vals: { fiscalyear_lock_date: false },
    });
  }
}

async function stepThroughput(ctx: Ctx): Promise<string> {
  const total = 100;
  const startedAt = Date.now();
  for (let index = 0; index < total; index += 1) {
    await ctx.client.call(
      "res.partner",
      "search_read",
      { domain: [["id", ">", 0]], fields: ["id", "name"], limit: 10 },
      { idempotent: true },
    );
  }
  const elapsed = (Date.now() - startedAt) / 1000;
  ctx.callsPerSecond = total / elapsed;
  return `${total} search_read in ${elapsed.toFixed(2)} s → ${ctx.callsPerSecond.toFixed(1)} calls/s, serial`;
}

await main();
