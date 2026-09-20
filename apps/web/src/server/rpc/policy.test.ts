import { describe, expect, it } from "vitest";
import { isAllowed, ROLES } from "./policy";

const call = (path: string, method: string, role: string | null, session = role !== null) =>
  isAllowed({ path: path.split("."), method, role, session });

describe("SEC-01 role policy", () => {
  it("lets the owner-admin call everything", () => {
    for (const [path, method] of [
      ["ops.search", "GET"],
      ["commands.approvals.decide", "POST"],
      ["finance.cca.record", "POST"],
      ["documents.download", "GET"],
      ["patrimoine.units.update", "PATCH"],
      ["commands.submit", "POST"],
    ] as const) {
      expect(call(path, method, "owner_admin"), path).toBe(true);
    }
  });

  it("closes an unlisted procedure to anyone below owner or manager for writes, and to readers for reads only", () => {
    expect(call("patrimoine.units.update", "PATCH", "delegated_manager")).toBe(true);
    expect(call("patrimoine.units.update", "PATCH", "accountant")).toBe(false);
    expect(call("patrimoine.units.list", "GET", "accountant")).toBe(true);
    expect(call("patrimoine.units.list", "GET", "partner_reader")).toBe(false);
  });

  it("keeps the partners' accounts away from a delegated manager and writes away from the accountant", () => {
    expect(call("finance.cca.list", "GET", "delegated_manager")).toBe(false);
    expect(call("finance.cca.list", "GET", "accountant")).toBe(true);
    expect(call("finance.cca.record", "POST", "accountant")).toBe(false);
  });

  it("reserves decisions and the ops screen to the owner-admin", () => {
    for (const role of ROLES.filter((candidate) => candidate !== "owner_admin")) {
      expect(call("commands.approvals.decide", "POST", role), role).toBe(false);
      expect(call("ops.queues", "GET", role), role).toBe(false);
    }
  });

  it("gives a partner reader the shared indicators, their own settings and nothing that names a tenant", () => {
    expect(call("accueil.situation", "GET", "partner_reader")).toBe(true);
    expect(call("parametres.securite.status", "GET", "partner_reader")).toBe(true);
    expect(call("accueil.actionRequired", "GET", "partner_reader")).toBe(false);
    expect(call("locations.persons.list", "GET", "partner_reader")).toBe(false);
    expect(call("documents.download", "GET", "partner_reader")).toBe(false);
    expect(call("commands.submit", "POST", "partner_reader")).toBe(false);
  });

  it("treats a session without a membership as no role at all", () => {
    expect(call("health.ready", "GET", null, false)).toBe(true);
    expect(call("me.get", "GET", null, true)).toBe(true);
    expect(call("me.get", "GET", null, false)).toBe(false);
    expect(call("patrimoine.units.list", "GET", null, true)).toBe(false);
    expect(call("patrimoine.units.list", "GET", "tenant_portal", true)).toBe(false);
  });

  it("classifies by the contract method, so a POST read is treated as a write", () => {
    expect(call("recherche.search", "POST", "accountant")).toBe(false);
    expect(call("recherche.search", "GET", "accountant")).toBe(true);
  });
});
