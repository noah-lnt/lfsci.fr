/**
 * MIG-02 opening balances: what the application computes at one date against the
 * ledger, difference by difference, never corrected.
 * Run: npx tsx --env-file-if-exists=.env scripts/migrate/balances.ts --organization <uuid> --as-of 2026-12-31 [--ledger odoo | --ledger soldes.csv | --odoo-copy <postgres url>] [--out file.json]
 */
import { join } from "node:path";
import {
  compareBalances,
  createCsvLedger,
  createOdooCopyLedger,
  createOdooLedger,
  DEFAULT_PREFIXES,
  type LedgerReader,
  readAppBalances,
  renderBalances,
} from "./src/balances";
import {
  EXIT_BLOCKED,
  EXIT_OK,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
  flag,
  has,
  type Io,
  outDir,
  parseArgs,
  stdio,
} from "./src/cli";
import { SourceUnreachable } from "./src/model";
import { table, writeJson } from "./src/report";
import { dbFromEnv, odooClientFromEnv } from "./src/runtime";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function main(argv: string[], io: Io = stdio): Promise<number> {
  const args = parseArgs(argv);
  const organizationId = flag(args, "organization");
  const asOf = flag(args, "as-of");
  const copyUrl = flag(args, "odoo-copy");
  const usage =
    "Usage : --organization <uuid> --as-of AAAA-MM-JJ [--ledger odoo | --ledger soldes.csv | --odoo-copy <url>]";
  if (!organizationId || !asOf || !ISO_DATE.test(asOf)) {
    io.err(usage);
    return EXIT_USAGE;
  }
  if ((has(args, "odoo-copy") && !copyUrl) || (copyUrl && has(args, "ledger"))) {
    io.err(usage);
    return EXIT_USAGE;
  }
  const ledgerArg = flag(args, "ledger") ?? "odoo";
  const prefixes = { ...DEFAULT_PREFIXES };
  for (const key of Object.keys(prefixes) as (keyof typeof prefixes)[]) {
    const value = flag(args, `account-${key}`);
    if (value) prefixes[key] = value;
  }
  const ledger: LedgerReader = copyUrl
    ? createOdooCopyLedger(copyUrl, prefixes)
    : ledgerArg === "odoo"
      ? createOdooLedger(odooClientFromEnv(), prefixes)
      : createCsvLedger(ledgerArg);
  const out = flag(args, "out") ?? join(outDir, `balances-${asOf}.json`);
  const db = dbFromEnv();
  try {
    const app = await readAppBalances(db, organizationId, asOf);
    const figures = await ledger.read(asOf);
    const report = compareBalances(organizationId, app, figures);
    writeJson(out, report);
    io.out(renderBalances(report, table));
    io.out(`\nRapport JSON : ${out}`);
    return report.blockers.length === 0 ? EXIT_OK : EXIT_BLOCKED;
  } catch (error) {
    if (error instanceof SourceUnreachable) {
      io.err(`Rapprochement interrompu : ${error.message}`);
      return EXIT_UNREACHABLE;
    }
    throw error;
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith("balances.ts")) {
  process.exitCode = await main(process.argv.slice(2));
}
