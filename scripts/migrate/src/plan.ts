import { decimal, neg, sum, toMoney } from "@lfsci/domain";
import { groupPersons, groupSuppliers, resolve, resolvePerson, resolveSupplier } from "./matching";
import type {
  Ambiguity,
  Deferral,
  EntityTotals,
  ExistingRows,
  LeaseRecord,
  Match,
  PersonRecord,
  Plan,
  Proposal,
  RecordKind,
  Rejection,
  RentTermRecord,
  Resolutions,
  SourceRead,
  SourceRecord,
  Target,
} from "./model";
import { nameKey } from "./normalise";

export type BuildPlanInput = {
  organizationId: string;
  reads: SourceRead[];
  existing: ExistingRows;
  now?: () => Date;
};

function sameTarget(a: Target, b: Target): boolean {
  if ("existingId" in a && "existingId" in b) return a.existingId === b.existingId;
  if ("create" in a && "create" in b) return a.create === b.create;
  return false;
}

function entityOf(
  record: SourceRecord,
): { key: string; label: string; odooId: number | null } | null {
  if (!("entity" in record)) return null;
  const odooId = "odooCompanyId" in record ? record.odooCompanyId : null;
  if (odooId !== null) return { key: `odoo:${odooId}`, label: record.entity, odooId };
  if (record.entity.trim() === "") return null;
  return { key: `name:${nameKey(record.entity)}`, label: record.entity, odooId: null };
}

function moneyOf(record: SourceRecord): string | null {
  switch (record.kind) {
    case "lease":
      return record.rent;
    case "rent_term":
      return record.total;
    case "expense":
      return record.totalInclTax;
    case "loan":
      return record.principal;
    case "asset":
      return record.grossValue;
    case "bank_line":
      return record.amount;
    case "booking":
      return record.accommodationAmount;
    case "deposit_movement":
    case "cca_movement":
    case "loan_movement":
      return record.amount;
    default:
      return null;
  }
}

/** The monthly total seen most often; a tie goes to the most recent month. */
function usualMonthlyTotal(terms: RentTermRecord[]): string {
  const byMonth = new Map<string, string[]>();
  for (const term of terms) {
    const bucket = byMonth.get(term.periodStart) ?? [];
    bucket.push(term.total);
    byMonth.set(term.periodStart, bucket);
  }
  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, values]) => toMoney(sum(values.map((v) => decimal(v)))));
  let best: { total: string; count: number } | null = null;
  for (const total of monthly) {
    const count = monthly.filter((v) => v === total).length;
    if (best === null || count >= best.count) best = { total, count };
  }
  return best?.total ?? "0.00";
}

/**
 * A tenant whose rents were received but who has no lease anywhere: the lease is
 * proposed from the receipts, the usual monthly total giving the rent and the charges.
 */
function inferLease(terms: RentTermRecord[], records: SourceRecord[]): LeaseRecord | null {
  const first = [...terms].sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0];
  if (!first) return null;
  const rent = terms.filter((t) => t.component === "rent");
  const charges = terms.filter((t) => t.component === "charges");
  const deposit = sum(
    records.flatMap((r) =>
      r.kind === "deposit_movement" &&
      r.odooPartnerId === first.odooPartnerId &&
      r.entity === first.entity
        ? [r.direction === "received" ? decimal(r.amount) : neg(decimal(r.amount))]
        : [],
    ),
  );
  return {
    source: first.source,
    kind: "lease",
    ref: `res.partner:${first.odooPartnerId}`,
    entity: first.entity,
    odooCompanyId: first.odooCompanyId,
    reference: `BAIL-ODOO-${first.odooPartnerId}`,
    tenantName: first.partnerName,
    unitCode: null,
    leaseKind: "other",
    startsOn: first.periodStart,
    endsOn: null,
    rent: usualMonthlyTotal(rent),
    charges: usualMonthlyTotal(charges),
    deposit: deposit.gt(0) ? toMoney(deposit) : null,
    paymentDay: null,
    inferred: true,
  };
}

export function buildPlan(input: BuildPlanInput): Plan {
  const { existing } = input;
  const now = input.now ?? (() => new Date());
  const records = input.reads.flatMap((read) => read.records);
  const rejections: Rejection[] = input.reads.flatMap((read) => read.rejections);
  const matches: Match[] = [];
  const ambiguities: Ambiguity[] = [];
  const deferrals: Deferral[] = [];
  const proposals: Proposal[] = [];
  const resolutions: Resolutions = {
    entities: {},
    persons: {},
    personGroups: {},
    suppliers: {},
    supplierGroups: {},
    leases: {},
    leaseTenants: {},
    rentTermLeases: {},
    buildings: {},
  };
  const rejectedRefs = new Set<string>();
  const reject = (record: SourceRecord, reason: Rejection["reason"], detail: string) => {
    rejectedRefs.add(`${record.kind}:${record.ref}`);
    rejections.push({
      source: record.source,
      kind: record.kind,
      ref: record.ref,
      ...(record.line !== undefined ? { line: record.line } : {}),
      reason,
      detail,
    });
  };
  const isRejected = (record: SourceRecord) => rejectedRefs.has(`${record.kind}:${record.ref}`);

  const entityKeys = new Map<string, string>();
  const entityMatched = new Set<string>();
  function resolveEntity(record: SourceRecord): string | null {
    const entity = entityOf(record);
    if (entity === null) return null;
    const cached = entityKeys.get(entity.key);
    if (cached !== undefined) return cached;
    const resolution = resolve("legal_entity", entity.key, entity.label, [
      {
        evidence: "odoo_company_id",
        confidence: "high",
        candidates: existing.entities
          .filter((e) => entity.odooId !== null && e.odooCompanyId === entity.odooId)
          .map((e) => ({ id: e.id, label: e.name })),
      },
      {
        evidence: "name",
        confidence: "medium",
        candidates: existing.entities
          .filter((e) => nameKey(e.name) === nameKey(entity.label))
          .map((e) => ({ id: e.id, label: e.name })),
      },
    ]);
    if (resolution.outcome === "match") {
      const { existingId } = resolution.match;
      entityKeys.set(entity.key, existingId);
      resolutions.entities[entity.key] = existingId;
      if (!matches.some((m) => m.kind === "legal_entity" && m.existingId === existingId)) {
        matches.push(resolution.match);
      }
      return existingId;
    }
    if (resolution.outcome === "ambiguous" && !entityMatched.has(entity.key)) {
      entityMatched.add(entity.key);
      ambiguities.push(resolution.ambiguity);
    }
    return null;
  }

  for (const record of records) {
    if (!("entity" in record) || record.kind === "bank_line") continue;
    if (resolveEntity(record) === null) {
      const label = entityOf(record)?.label ?? "(vide)";
      reject(
        record,
        "unknown_entity",
        `Société « ${label} » absente de l’application : créez-la avant l’import`,
      );
    }
  }

  const personRecords = records.filter((r): r is PersonRecord => r.kind === "person");
  const grouped = groupPersons(personRecords);
  ambiguities.push(...grouped.ambiguities);
  for (const group of grouped.groups) {
    const first = group[0];
    if (!first) continue;
    const found = group
      .map((record) => resolvePerson(record, existing.persons))
      .find((resolution) => resolution.outcome !== "none");
    if (found?.outcome === "ambiguous") {
      ambiguities.push(found.ambiguity);
      continue;
    }
    const target: Target =
      found?.outcome === "match"
        ? { existingId: found.match.existingId }
        : { create: `person:${nameKey(first.displayName)}` };
    if (found?.outcome === "match") matches.push(found.match);
    if ("create" in target) {
      resolutions.personGroups[target.create] = {
        ...first,
        email: group.map((r) => r.email).find((value) => value !== null) ?? null,
        phone: group.map((r) => r.phone).find((value) => value !== null) ?? null,
        odooPartnerId: group.map((r) => r.odooPartnerId).find((value) => value !== null) ?? null,
      };
    }
    for (const record of group) resolutions.persons[record.ref] = target;
  }

  const supplierRecords = records.filter((r) => r.kind === "supplier");
  for (const group of groupSuppliers(supplierRecords)) {
    const first = group[0];
    if (!first) continue;
    const found = group
      .map((record) => resolveSupplier(record, existing.suppliers))
      .find((resolution) => resolution.outcome !== "none");
    if (found?.outcome === "ambiguous") {
      ambiguities.push(found.ambiguity);
      continue;
    }
    const target: Target =
      found?.outcome === "match"
        ? { existingId: found.match.existingId }
        : { create: `supplier:${first.odooPartnerId ?? nameKey(first.name)}` };
    if (found?.outcome === "match") matches.push(found.match);
    if ("create" in target) resolutions.supplierGroups[target.create] = first;
    for (const record of group) resolutions.suppliers[record.ref] = target;
  }

  function personByName(name: string): Target | "ambiguous" | null {
    const key = nameKey(name);
    const planned = personRecords
      .filter((r) => nameKey(r.displayName) === key)
      .map((r) => resolutions.persons[r.ref])
      .filter((t): t is Target => t !== undefined);
    const fromExisting = existing.persons
      .filter((p) => nameKey(p.displayName) === key)
      .map((p): Target => ({ existingId: p.id }));
    const targets: Target[] = [];
    for (const target of [...planned, ...fromExisting]) {
      if (!targets.some((known) => sameTarget(known, target))) targets.push(target);
    }
    if (targets.length > 1) return "ambiguous";
    return targets[0] ?? null;
  }

  const leaseRecords = records.filter((r): r is LeaseRecord => r.kind === "lease");
  for (const lease of leaseRecords) {
    if (isRejected(lease)) continue;
    const entityId = resolveEntity(lease);
    const tenant = personByName(lease.tenantName);
    if (tenant === "ambiguous") {
      ambiguities.push({
        kind: "person",
        ref: lease.ref,
        label: lease.tenantName,
        evidence: "name",
        candidates: [],
      });
      continue;
    }
    if (tenant === null) {
      reject(
        lease,
        "unknown_person",
        `Locataire « ${lease.tenantName} » absent des locataires lus et de l’application`,
      );
      continue;
    }
    resolutions.leaseTenants[lease.ref] = tenant;
    const found = existing.leases.filter(
      (l) => l.legalEntityId === entityId && l.reference === lease.reference,
    );
    if (found.length === 1 && found[0]) {
      resolutions.leases[lease.ref] = { existingId: found[0].id };
      matches.push({
        kind: "lease",
        ref: lease.ref,
        label: lease.reference,
        existingId: found[0].id,
        existingLabel: found[0].reference,
        evidence: "reference",
        confidence: "high",
      });
    } else {
      resolutions.leases[lease.ref] = { create: `lease:${lease.reference}` };
    }
  }

  function leasesForTenant(entityId: string, tenant: Target): Target[] {
    const out: Target[] = [];
    if ("existingId" in tenant) {
      for (const lease of existing.leases) {
        if (lease.legalEntityId === entityId && lease.holderPersonIds.includes(tenant.existingId)) {
          out.push({ existingId: lease.id });
        }
      }
    }
    for (const lease of leaseRecords) {
      const target = resolutions.leases[lease.ref];
      const leaseTenant = resolutions.leaseTenants[lease.ref];
      if (!target || !leaseTenant || !sameTarget(leaseTenant, tenant)) continue;
      if (resolutions.entities[entityOf(lease)?.key ?? ""] !== entityId) continue;
      if (!out.some((known) => sameTarget(known, target))) out.push(target);
    }
    return out;
  }

  const rentTerms = records.filter((r): r is RentTermRecord => r.kind === "rent_term");
  const byTenant = new Map<string, { entityId: string; tenant: Target; terms: RentTermRecord[] }>();
  for (const record of rentTerms) {
    if (isRejected(record)) continue;
    const entityId = resolveEntity(record);
    const tenant = resolutions.persons[`res.partner:${record.odooPartnerId}`];
    if (entityId === null || !tenant) continue;
    const key = `${entityId}|${"existingId" in tenant ? tenant.existingId : tenant.create}`;
    const group = byTenant.get(key) ?? { entityId, tenant, terms: [] };
    group.terms.push(record);
    byTenant.set(key, group);
  }
  for (const group of byTenant.values()) {
    if (leasesForTenant(group.entityId, group.tenant).length > 0) continue;
    const lease = inferLease(group.terms, records);
    if (lease === null) continue;
    records.push(lease);
    leaseRecords.push(lease);
    resolutions.leaseTenants[lease.ref] = group.tenant;
    resolutions.leases[lease.ref] = { create: `lease:${lease.reference}` };
    const last = group.terms
      .map((t) => t.dueOn)
      .sort()
      .at(-1);
    proposals.push({
      kind: "lease",
      ref: lease.ref,
      detail: `${lease.reference} pour ${lease.tenantName} : ${group.terms.length} encaissement(s) du ${lease.startsOn} au ${last}, loyer ${lease.rent}, charges ${lease.charges}${lease.deposit ? `, dépôt ${lease.deposit}` : ""} — aucun bail dans l’application ni dans les tableaux ; la date de fin, le lot et le jour de paiement sont à compléter`,
    });
  }

  for (const record of records) {
    if (record.kind !== "rent_term" || isRejected(record)) continue;
    const entityId = resolveEntity(record);
    const tenant = resolutions.persons[`res.partner:${record.odooPartnerId}`];
    if (entityId === null || !tenant) {
      reject(
        record,
        "unknown_person",
        `Partenaire Odoo ${record.odooPartnerId} (${record.partnerName}) sans personne résolue`,
      );
      continue;
    }
    const leases = leasesForTenant(entityId, tenant);
    if (leases.length === 0) {
      reject(
        record,
        "unknown_lease",
        `Aucun bail pour ${record.partnerName} dans ${record.entity} : ajoutez-le au tableau des baux`,
      );
      continue;
    }
    const first = leases[0];
    if (leases.length > 1 || !first) {
      ambiguities.push({
        kind: "lease",
        ref: record.ref,
        label: `${record.odooMoveName} — ${record.partnerName}`,
        evidence: "tenant",
        candidates: leases.map((target) => ({
          id: "existingId" in target ? target.existingId : target.create,
          label: "existingId" in target ? `bail existant ${target.existingId}` : target.create,
        })),
      });
      continue;
    }
    resolutions.rentTermLeases[record.ref] = first;
  }

  for (const record of records) {
    if (record.kind !== "expense" || isRejected(record)) continue;
    if (!resolutions.suppliers[`res.partner:${record.odooPartnerId}`]) {
      reject(
        record,
        "unknown_person",
        `Fournisseur Odoo ${record.odooPartnerId} (${record.supplierName}) sans rang fournisseur`,
      );
    }
  }

  for (const record of records) {
    if (record.kind !== "meter" || isRejected(record)) continue;
    const entityId = resolveEntity(record);
    const building = existing.buildings.find(
      (b) => b.legalEntityId === entityId && nameKey(b.code) === nameKey(record.buildingCode),
    );
    if (!building) {
      reject(
        record,
        "unknown_building",
        `Immeuble « ${record.buildingCode} » absent de ${record.entity}`,
      );
      continue;
    }
    resolutions.buildings[record.ref] = building.id;
    if (matches.some((m) => m.kind === "building" && m.existingId === building.id)) continue;
    matches.push({
      kind: "building",
      ref: record.ref,
      label: record.buildingCode,
      existingId: building.id,
      existingLabel: building.code,
      evidence: "code",
      confidence: "high",
    });
  }

  for (const record of records) {
    if (
      record.kind === "deposit_movement" ||
      record.kind === "cca_movement" ||
      record.kind === "loan_movement"
    ) {
      deferrals.push({
        kind: record.kind,
        ref: record.ref,
        reason: "entered_in_app",
        detail: `${record.odooMoveName} ${record.occurredOn} ${record.direction} ${record.amount} (${record.partnerName}) : mouvement à saisir dans l’application, le rapport de soldes le rapproche`,
      });
    }
    if (record.kind === "bank_line") {
      deferrals.push({
        kind: "bank_line",
        ref: record.ref,
        reason: "owned_by_backsync",
        detail: `${record.journal} ${record.date} ${record.amount} : les lignes bancaires sont recopiées par odoo.backsync`,
      });
    }
    if (record.kind === "booking") {
      deferrals.push({
        kind: "booking",
        ref: record.ref,
        reason: "use_in_app_import",
        detail: `${record.externalBookingId} ${record.checkInOn}→${record.checkOutOn} : passe par l’import Courte durée de l’application`,
      });
    }
  }

  const perEntityMap = new Map<
    string,
    EntityTotals & { sums: Partial<Record<RecordKind, string[]>> }
  >();
  for (const record of records) {
    if (isRejected(record)) continue;
    const key = entityOf(record)?.key;
    const entityId = key ? resolutions.entities[key] : undefined;
    if (!entityId) continue;
    const entity = existing.entities.find((e) => e.id === entityId);
    let totals = perEntityMap.get(entityId);
    if (!totals) {
      totals = { entityId, entityName: entity?.name ?? entityId, counts: {}, totals: {}, sums: {} };
      perEntityMap.set(entityId, totals);
    }
    totals.counts[record.kind] = (totals.counts[record.kind] ?? 0) + 1;
    const amount = moneyOf(record);
    if (amount !== null) {
      const values = totals.sums[record.kind] ?? [];
      values.push(amount);
      totals.sums[record.kind] = values;
    }
  }
  const perEntity: EntityTotals[] = [...perEntityMap.values()].map(({ sums, ...rest }) => {
    const totals: Partial<Record<RecordKind, string>> = {};
    for (const [kind, values] of Object.entries(sums) as [RecordKind, string[]][]) {
      totals[kind] = toMoney(sum(values.map((value) => decimal(value))));
    }
    return { ...rest, totals };
  });

  const blockers: string[] = [];
  for (const read of input.reads) {
    if (read.found === 0)
      blockers.push(
        `${read.label} : aucun enregistrement lu — extraction défaillante ou source vide, à vérifier avant tout import`,
      );
    const bound = read.records.filter((r) => entityOf(r) !== null && r.kind !== "bank_line");
    const unknown = bound.filter((r) =>
      rejections.some((x) => x.reason === "unknown_entity" && x.kind === r.kind && x.ref === r.ref),
    );
    if (bound.length > 0 && unknown.length === bound.length)
      blockers.push(
        `${read.label} : aucune société de cette source n’existe dans l’application — créez-la (avec son id Odoo) avant l’import`,
      );
  }
  if (ambiguities.length > 0)
    blockers.push(
      `${ambiguities.length} correspondance(s) ambiguë(s) à trancher par le propriétaire`,
    );

  return {
    generatedAt: now().toISOString(),
    organizationId: input.organizationId,
    sources: input.reads.map((read) => ({
      source: read.source,
      label: read.label,
      found: read.found,
      mapped: read.records.length,
      rejected: read.rejections.length,
      notes: read.notes,
      coverage: read.coverage,
      readAt: read.readAt,
    })),
    records,
    rejections,
    matches,
    ambiguities,
    deferrals,
    proposals,
    resolutions,
    perEntity,
    blockers,
  };
}
