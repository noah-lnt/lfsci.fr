/**
 * Writes what a dry run showed, and only with --apply.
 * Run: npx tsx --env-file-if-exists=.env scripts/migrate/apply.ts --plan scripts/migrate/out/dry-run.json --apply
 */
import { readFileSync } from "node:fs";
import { ApplyRefused, applyPlan } from "./src/apply";
import {
  EXIT_BLOCKED,
  EXIT_OK,
  EXIT_UNREACHABLE,
  EXIT_USAGE,
  flag,
  has,
  type Io,
  parseArgs,
  stdio,
} from "./src/cli";
import type { Plan } from "./src/model";
import { renderPlan, table } from "./src/report";
import { dbFromEnv } from "./src/runtime";

export async function main(argv: string[], io: Io = stdio): Promise<number> {
  const args = parseArgs(argv);
  const planPath = flag(args, "plan");
  if (!planPath) {
    io.err("Usage : --plan <fichier json de l’import à blanc> --apply");
    return EXIT_USAGE;
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8")) as Plan;
  if (!has(args, "apply")) {
    io.out(renderPlan(plan));
    io.out("\nAucune écriture : relancez avec --apply pour écrire ce plan.");
    return plan.blockers.length === 0 ? EXIT_OK : EXIT_BLOCKED;
  }
  const db = dbFromEnv();
  try {
    const report = await applyPlan(db, plan);
    io.out(`Lot d’import ${report.batchId}`);
    io.out(
      table(
        ["nature", "écrits"],
        Object.entries(report.written).map(([kind, count]) => [kind, String(count)]),
      ),
    );
    io.out(
      table(
        ["société", "lignes écrites"],
        report.entities.map((entity) => [entity.entityName, String(entity.written)]),
      ),
    );
    io.out(
      `${report.alreadyImported} ligne(s) déjà importées par un lot précédent, laissées telles quelles.`,
    );
    return EXIT_OK;
  } catch (error) {
    if (error instanceof ApplyRefused) {
      io.err(`Import refusé : ${error.message}`);
      return EXIT_BLOCKED;
    }
    io.err(`Import interrompu : ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_UNREACHABLE;
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith("apply.ts")) {
  process.exitCode = await main(process.argv.slice(2));
}
