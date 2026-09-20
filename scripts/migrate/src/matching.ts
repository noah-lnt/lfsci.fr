import type {
  Ambiguity,
  Confidence,
  ExistingPerson,
  ExistingSupplier,
  Match,
  MatchEvidence,
  MatchKind,
  PersonRecord,
  SupplierRecord,
} from "./model";
import { emailKey, nameKey } from "./normalise";

export type Candidate = { id: string; label: string };

export type Resolution =
  | { outcome: "match"; match: Match }
  | { outcome: "ambiguous"; ambiguity: Ambiguity }
  | { outcome: "none" };

type Probe = { evidence: MatchEvidence; confidence: Confidence; candidates: Candidate[] };

/**
 * The strongest evidence with at least one candidate decides; several candidates on
 * that evidence are reported, never resolved by taking the first.
 */
export function resolve(kind: MatchKind, ref: string, label: string, probes: Probe[]): Resolution {
  for (const probe of probes) {
    if (probe.candidates.length === 0) continue;
    const first = probe.candidates[0];
    if (probe.candidates.length === 1 && first) {
      return {
        outcome: "match",
        match: {
          kind,
          ref,
          label,
          existingId: first.id,
          existingLabel: first.label,
          evidence: probe.evidence,
          confidence: probe.confidence,
        },
      };
    }
    return {
      outcome: "ambiguous",
      ambiguity: { kind, ref, label, evidence: probe.evidence, candidates: probe.candidates },
    };
  }
  return { outcome: "none" };
}

export function resolvePerson(record: PersonRecord, existing: ExistingPerson[]): Resolution {
  const email = emailKey(record.email);
  const key = nameKey(record.displayName);
  const candidate = (person: ExistingPerson): Candidate => ({
    id: person.id,
    label: person.displayName,
  });
  return resolve("person", record.ref, record.displayName, [
    {
      evidence: "odoo_partner_id",
      confidence: "high",
      candidates: existing
        .filter((p) => record.odooPartnerId !== null && p.odooPartnerId === record.odooPartnerId)
        .map(candidate),
    },
    {
      evidence: "email",
      confidence: "high",
      candidates: existing
        .filter((p) => email !== null && p.emails.some((value) => emailKey(value) === email))
        .map(candidate),
    },
    {
      evidence: "name",
      confidence: "medium",
      candidates: existing.filter((p) => nameKey(p.displayName) === key).map(candidate),
    },
  ]);
}

export function resolveSupplier(record: SupplierRecord, existing: ExistingSupplier[]): Resolution {
  const key = nameKey(record.name);
  const candidate = (supplier: ExistingSupplier): Candidate => ({
    id: supplier.id,
    label: supplier.name,
  });
  return resolve("supplier", record.ref, record.name, [
    {
      evidence: "odoo_partner_id",
      confidence: "high",
      candidates: existing
        .filter((s) => record.odooPartnerId !== null && s.odooPartnerId === record.odooPartnerId)
        .map(candidate),
    },
    {
      evidence: "name",
      confidence: "medium",
      candidates: existing.filter((s) => nameKey(s.name) === key).map(candidate),
    },
  ]);
}

/**
 * Records of one kind read from several sources that describe the same object:
 * the same Odoo partner, the same email, or the same name. Two Odoo partners under
 * one name are two objects Odoo already distinguishes; the owner decides.
 */
export function groupPersons(records: PersonRecord[]): {
  groups: PersonRecord[][];
  ambiguities: Ambiguity[];
} {
  const groups: PersonRecord[][] = [];
  const ambiguities: Ambiguity[] = [];
  const byName = new Map<string, PersonRecord[]>();
  for (const record of records) {
    const key = nameKey(record.displayName);
    const bucket = byName.get(key);
    if (bucket) bucket.push(record);
    else byName.set(key, [record]);
  }
  for (const [, bucket] of byName) {
    const partnerIds = new Set(
      bucket.map((r) => r.odooPartnerId).filter((id): id is number => id !== null),
    );
    const emails = new Set(
      bucket.map((r) => emailKey(r.email)).filter((value): value is string => value !== null),
    );
    if (partnerIds.size > 1 || emails.size > 1) {
      const first = bucket[0];
      if (!first) continue;
      ambiguities.push({
        kind: "person",
        ref: first.ref,
        label: first.displayName,
        evidence: partnerIds.size > 1 ? "odoo_partner_id" : "email",
        candidates: bucket.map((r) => ({
          id: r.ref,
          label: `${r.displayName} (${r.source}${r.odooPartnerId !== null ? `, Odoo ${r.odooPartnerId}` : ""}${r.email ? `, ${r.email}` : ""})`,
        })),
      });
      continue;
    }
    groups.push(bucket);
  }
  return { groups, ambiguities };
}

export function groupSuppliers(records: SupplierRecord[]): SupplierRecord[][] {
  const byKey = new Map<string, SupplierRecord[]>();
  for (const record of records) {
    const key =
      record.odooPartnerId !== null
        ? `odoo:${record.odooPartnerId}`
        : `name:${nameKey(record.name)}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(record);
    else byKey.set(key, [record]);
  }
  return [...byKey.values()];
}
