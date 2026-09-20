/**
 * MIG-01 inventory: reads every source, writes nothing, reports counts, rejects,
 * proposed matches and totals per legal entity.
 * Run: npx tsx --env-file-if-exists=.env scripts/migrate/dry-run.ts --organization <uuid> [--odoo | --odoo-copy <postgres url>] [--tenants f.csv] [--leases f.csv] [--meters f.csv] [--loans f.csv] [--bookings f.csv] [--out file.json]
 */
import { join } from "node:path";
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
import { runDryRun } from "./src/dry-run";
import { readExistingRows } from "./src/existing";
import type { MappingKind } from "./src/mapping";
import type { SourceReader } from "./src/model";
import { renderPlan, writeJson } from "./src/report";
import { dbFromEnv, odooClientFromEnv } from "./src/runtime";
import { createOdooSource } from "./src/sources/odoo";
import { createOdooCopySource } from "./src/sources/odoo-copy";
import {
  createPlatformSource,
  createSpreadsheetSource,
  type SpreadsheetFile,
} from "./src/sources/spreadsheet";

const SPREADSHEETS: MappingKind[] = ["tenants", "leases", "meters", "loans"];

export function readersFromArgs(
  argv: string[],
  factories: { odoo: () => SourceReader; odooCopy: (url: string) => SourceReader } = {
    odoo: () => createOdooSource({ client: odooClientFromEnv() }),
    odooCopy: (url) => createOdooCopySource({ url }),
  },
): { readers: SourceReader[]; organizationId: string; out: string } | { usage: string } {
  const args = parseArgs(argv);
  const organizationId = flag(args, "organization");
  if (!organizationId) return { usage: "--organization <uuid> est obligatoire" };
  const readers: SourceReader[] = [];
  const copyUrl = flag(args, "odoo-copy");
  if (has(args, "odoo-copy") && !copyUrl) {
    return { usage: "--odoo-copy attend l’URL PostgreSQL de la copie restaurée" };
  }
  if (has(args, "odoo") && copyUrl) return { usage: "--odoo et --odoo-copy sont exclusifs" };
  if (has(args, "odoo")) readers.push(factories.odoo());
  if (copyUrl) readers.push(factories.odooCopy(copyUrl));
  const files: SpreadsheetFile[] = [];
  for (const kind of SPREADSHEETS) {
    const path = flag(args, kind);
    if (!path) continue;
    const mappingVersion = flag(args, `${kind}-mapping`);
    files.push(mappingVersion ? { kind, path, mappingVersion } : { kind, path });
  }
  if (files.length > 0) readers.push(createSpreadsheetSource(files));
  const bookings = flag(args, "bookings");
  if (bookings) readers.push(createPlatformSource(bookings, flag(args, "bookings-mapping")));
  if (readers.length === 0) {
    return {
      usage:
        "aucune source : --odoo, --odoo-copy <url>, --tenants, --leases, --meters, --loans ou --bookings",
    };
  }
  return { readers, organizationId, out: flag(args, "out") ?? join(outDir, "dry-run.json") };
}

export async function main(argv: string[], io: Io = stdio): Promise<number> {
  const parsed = readersFromArgs(argv);
  if ("usage" in parsed) {
    io.err(`Usage : ${parsed.usage}`);
    return EXIT_USAGE;
  }
  const db = dbFromEnv();
  try {
    const result = await runDryRun({
      organizationId: parsed.organizationId,
      readers: parsed.readers,
      existing: () => readExistingRows(db, parsed.organizationId),
    });
    if (!result.ok) {
      io.err(
        "Import à blanc interrompu : une source n’a pas pu être lue. Rien n’a été inventorié.",
      );
      for (const failure of result.failures) io.err(`  ✗ ${failure.source} : ${failure.message}`);
      return EXIT_UNREACHABLE;
    }
    writeJson(parsed.out, result.plan);
    io.out(renderPlan(result.plan));
    io.out(`\nRapport JSON : ${parsed.out}`);
    return result.plan.blockers.length === 0 ? EXIT_OK : EXIT_BLOCKED;
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith("dry-run.ts")) {
  process.exitCode = await main(process.argv.slice(2));
}
