import { describe, expect, it } from "vitest";
import { groupPersons, resolvePerson, resolveSupplier } from "../src/matching";
import type { PersonRecord } from "../src/model";
import { nameKey } from "../src/normalise";

function person(overrides: Partial<PersonRecord>): PersonRecord {
  return {
    source: "spreadsheet",
    kind: "person",
    ref: "T-1",
    displayName: "Camille Martin",
    roles: ["tenant"],
    email: null,
    phone: null,
    odooPartnerId: null,
    ...overrides,
  };
}

describe("name key", () => {
  it("ignores accents, case, punctuation and word order", () => {
    expect(nameKey("MARTIN Camille")).toBe(nameKey("Camille Martin"));
    expect(nameKey("Élodie DURAND-Léger")).toBe(nameKey("elodie durand leger"));
    expect(nameKey("Camille Martin")).not.toBe(nameKey("Camille Martine"));
  });
});

describe("matching", () => {
  it("proposes an existing person spelled differently, on the name, with medium confidence", () => {
    const resolution = resolvePerson(person({ displayName: "MARTIN Camille" }), [
      { id: "p1", displayName: "Camille Martin", odooPartnerId: null, emails: [] },
      { id: "p2", displayName: "Élodie Durand", odooPartnerId: null, emails: [] },
    ]);
    expect(resolution).toEqual({
      outcome: "match",
      match: expect.objectContaining({ existingId: "p1", evidence: "name", confidence: "medium" }),
    });
  });

  it("prefers the Odoo partner id, then the email, over the name", () => {
    const existing = [
      {
        id: "p1",
        displayName: "Camille Martin",
        odooPartnerId: null,
        emails: ["camille@example.test"],
      },
      { id: "p2", displayName: "C. Martin", odooPartnerId: 13, emails: [] },
    ];
    expect(resolvePerson(person({ odooPartnerId: 13 }), existing)).toMatchObject({
      match: { existingId: "p2", evidence: "odoo_partner_id", confidence: "high" },
    });
    expect(resolvePerson(person({ email: "Camille@Example.test" }), existing)).toMatchObject({
      match: { existingId: "p1", evidence: "email", confidence: "high" },
    });
  });

  it("reports two homonyms as ambiguous instead of picking the first", () => {
    const resolution = resolvePerson(person({}), [
      { id: "p1", displayName: "Camille Martin", odooPartnerId: null, emails: [] },
      { id: "p2", displayName: "Martin Camille", odooPartnerId: null, emails: [] },
    ]);
    expect(resolution.outcome).toBe("ambiguous");
    if (resolution.outcome !== "ambiguous") throw new Error("expected an ambiguity");
    expect(resolution.ambiguity.candidates.map((c) => c.id)).toEqual(["p1", "p2"]);
  });

  it("matches a supplier on its accent-stripped name", () => {
    const resolution = resolveSupplier(
      {
        source: "odoo",
        kind: "supplier",
        ref: "res.partner:14",
        name: "PLOMBERIE DÉPANNAGE",
        vat: null,
        odooPartnerId: 14,
      },
      [{ id: "s1", name: "Plomberie Depannage", odooPartnerId: null }],
    );
    expect(resolution).toMatchObject({ match: { existingId: "s1", evidence: "name" } });
  });

  it("merges one person read from two sources, and flags two Odoo partners under one name", () => {
    const merged = groupPersons([
      person({ source: "odoo", ref: "res.partner:13", odooPartnerId: 13 }),
      person({
        source: "spreadsheet",
        ref: "T-001",
        displayName: "MARTIN Camille",
        odooPartnerId: 13,
      }),
    ]);
    expect(merged.groups).toHaveLength(1);
    expect(merged.ambiguities).toEqual([]);

    const clash = groupPersons([
      person({ source: "odoo", ref: "res.partner:20", odooPartnerId: 20 }),
      person({ source: "odoo", ref: "res.partner:21", odooPartnerId: 21 }),
    ]);
    expect(clash.groups).toEqual([]);
    expect(clash.ambiguities[0]).toMatchObject({ kind: "person", evidence: "odoo_partner_id" });
    expect(clash.ambiguities[0]?.candidates).toHaveLength(2);
  });
});
