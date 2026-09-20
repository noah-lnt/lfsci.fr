import { isAppError } from "@lfsci/kernel";
import type { CapabilitySnapshot } from "@lfsci/odoo";
import { assertCapability, fetchCapabilitySnapshot } from "@lfsci/odoo";
import { describe, expect, it } from "vitest";
import { setup } from "./helpers";

const doc = {
  models: {
    "res.partner": { methods: ["search_read", "create"], fields: ["id", "name"] },
    "account.move": { methods: ["search_read"] },
  },
};

describe("capability snapshot", () => {
  it("captures /doc raw and parsed", async () => {
    const { server, client } = setup();
    server.setDoc(doc);
    const snapshot = await fetchCapabilitySnapshot(client);
    expect(snapshot.raw).toBe(JSON.stringify(doc));
    expect(snapshot.models?.["res.partner"]?.methods).toContain("create");
    expect(snapshot.database).toBe("lfsci-test");
    expect(Date.parse(snapshot.capturedAt)).not.toBeNaN();
  });

  it("passes when the snapshot is absent (Phase 0 fills it)", () => {
    expect(() => assertCapability(null, "account.move", "action_post")).not.toThrow();
    expect(() => assertCapability(undefined, "anything", "anything")).not.toThrow();
  });

  it("passes for a model and method present in the snapshot", async () => {
    const { server, client } = setup();
    server.setDoc(doc);
    const snapshot = await fetchCapabilitySnapshot(client);
    expect(() => assertCapability(snapshot, "res.partner", "create")).not.toThrow();
  });

  it("refuses an unknown method with RULE_VIOLATION", async () => {
    const { server, client } = setup();
    server.setDoc(doc);
    const snapshot = await fetchCapabilitySnapshot(client);
    const error = (() => {
      try {
        assertCapability(snapshot, "account.move", "action_post");
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(isAppError(error) && error.code).toBe("RULE_VIOLATION");
  });

  it("refuses an unknown model with RULE_VIOLATION", () => {
    const snapshot: CapabilitySnapshot = {
      capturedAt: "2026-09-19T00:00:00.000Z",
      baseUrl: "https://odoo.test",
      database: undefined,
      raw: "{}",
      parsed: {},
      models: { "res.partner": { methods: ["search_read"] } },
    };
    let code: string | undefined;
    try {
      assertCapability(snapshot, "account.bank.statement.line", "search_read");
    } catch (caught) {
      if (isAppError(caught)) code = caught.code;
    }
    expect(code).toBe("RULE_VIOLATION");
  });
});
