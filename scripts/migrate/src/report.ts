import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Plan, RecordKind } from "./model";

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`;
  const rule = `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`;
  return [line(headers), rule, ...rows.map(line)].join("\n");
}

const KIND_LABELS: Record<RecordKind, string> = {
  person: "personnes",
  supplier: "fournisseurs",
  lease: "baux",
  rent_term: "termes de loyer",
  expense: "dépenses",
  bank_line: "lignes bancaires",
  loan: "prêts",
  meter: "compteurs",
  asset: "immobilisations",
  booking: "réservations",
  deposit_movement: "mouvements de dépôt",
  cca_movement: "mouvements de compte courant",
  loan_movement: "mouvements d’emprunt",
};

export function renderPlan(plan: Plan): string {
  const out: string[] = [];
  out.push(`Import à blanc — organisation ${plan.organizationId} — ${plan.generatedAt}`, "");
  out.push("Sources");
  out.push(
    table(
      ["source", "lus", "mappés", "rejetés", "période", "lu le"],
      plan.sources.map((source) => [
        source.label,
        String(source.found),
        String(source.mapped),
        String(source.rejected),
        source.coverage.from ? `${source.coverage.from} → ${source.coverage.to}` : "—",
        source.readAt,
      ]),
    ),
  );
  for (const source of plan.sources) for (const note of source.notes) out.push(`  · ${note}`);
  out.push("");

  const counts = new Map<RecordKind, { mapped: number; rejected: number; deferred: number }>();
  const bump = (kind: RecordKind, field: "mapped" | "rejected" | "deferred") => {
    const entry = counts.get(kind) ?? { mapped: 0, rejected: 0, deferred: 0 };
    entry[field] += 1;
    counts.set(kind, entry);
  };
  const rejectedRefs = new Set(plan.rejections.map((r) => `${r.kind}:${r.ref}`));
  for (const record of plan.records) {
    if (!rejectedRefs.has(`${record.kind}:${record.ref}`)) bump(record.kind, "mapped");
  }
  for (const rejection of plan.rejections) bump(rejection.kind, "rejected");
  for (const deferral of plan.deferrals) bump(deferral.kind, "deferred");
  const persons = counts.get("person");
  if (persons) persons.mapped = Object.keys(plan.resolutions.personGroups).length;
  const suppliers = counts.get("supplier");
  if (suppliers) suppliers.mapped = Object.keys(plan.resolutions.supplierGroups).length;
  out.push(
    "Par nature (personnes et fournisseurs : distincts, hors correspondances avec l’existant)",
  );
  out.push(
    table(
      ["nature", "à importer", "rejetés", "différés"],
      [...counts.entries()].map(([kind, entry]) => [
        KIND_LABELS[kind],
        String(entry.mapped - entry.deferred),
        String(entry.rejected),
        String(entry.deferred),
      ]),
    ),
  );
  out.push("");

  out.push("Rejets");
  if (plan.rejections.length === 0) out.push("  aucun");
  else {
    const byReason = new Map<string, number>();
    for (const rejection of plan.rejections) {
      byReason.set(rejection.reason, (byReason.get(rejection.reason) ?? 0) + 1);
    }
    out.push(
      table(
        ["motif", "nombre"],
        [...byReason.entries()].map(([r, n]) => [r, String(n)]),
      ),
    );
    out.push(
      table(
        ["source", "nature", "référence", "motif", "détail"],
        plan.rejections.map((r) => [r.source, r.kind, r.ref, r.reason, r.detail]),
      ),
    );
  }
  out.push("");

  out.push("Correspondances proposées (jamais appliquées par l’import à blanc)");
  if (plan.matches.length === 0) out.push("  aucune");
  else {
    out.push(
      table(
        ["nature", "lu", "existant", "preuve", "confiance"],
        plan.matches.map((m) => [m.kind, m.label, m.existingLabel, m.evidence, m.confidence]),
      ),
    );
  }
  out.push("");

  out.push("Ambiguïtés à trancher par le propriétaire");
  if (plan.ambiguities.length === 0) out.push("  aucune");
  else {
    out.push(
      table(
        ["nature", "lu", "preuve", "candidats"],
        plan.ambiguities.map((a) => [
          a.kind,
          a.label,
          a.evidence,
          a.candidates.map((c) => c.label).join(" / ") || "plusieurs personnes portent ce nom",
        ]),
      ),
    );
  }
  out.push("");

  out.push("Baux proposés (déduits des loyers encaissés, créés par l’apply)");
  if (plan.proposals.length === 0) out.push("  aucun");
  else {
    out.push(
      table(
        ["nature", "référence", "détail"],
        plan.proposals.map((p) => [p.kind, p.ref, p.detail]),
      ),
    );
  }
  out.push("");

  out.push("Différés (lus, non écrits par l’import)");
  if (plan.deferrals.length === 0) out.push("  aucun");
  else {
    const byReason = new Map<string, number>();
    for (const deferral of plan.deferrals) {
      byReason.set(deferral.reason, (byReason.get(deferral.reason) ?? 0) + 1);
    }
    out.push(
      table(
        ["motif", "nombre"],
        [...byReason.entries()].map(([r, n]) => [r, String(n)]),
      ),
    );
  }
  out.push("");

  out.push("Inventaire par société (différés compris, rejets exclus)");
  if (plan.perEntity.length === 0) out.push("  aucune société résolue");
  else {
    const kinds = [
      ...new Set(plan.perEntity.flatMap((e) => Object.keys(e.counts) as RecordKind[])),
    ];
    out.push(
      table(
        ["société", ...kinds.map((kind) => KIND_LABELS[kind])],
        plan.perEntity.map((entity) => [
          entity.entityName,
          ...kinds.map((kind) => {
            const count = entity.counts[kind] ?? 0;
            const total = entity.totals[kind];
            return total === undefined ? String(count) : `${count} (${total})`;
          }),
        ]),
      ),
    );
  }
  out.push("");

  if (plan.blockers.length === 0)
    out.push("Aucun bloqueur : le plan peut être appliqué avec --apply.");
  else {
    out.push("Bloqueurs");
    for (const blocker of plan.blockers) out.push(`  ✗ ${blocker}`);
  }
  return out.join("\n");
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
