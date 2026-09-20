import { isAppError, runWithCorrelation } from "@lfsci/kernel";
import { assertCapability, introspectCapabilitySnapshot, shapeExecuteKw } from "@lfsci/odoo";
import { describe, expect, it } from "vitest";
import { noRetry, setupRpc } from "./helpers";

async function expectAppError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!isAppError(error)) throw new Error(`expected an AppError, received ${String(error)}`);
  return error;
}

describe("execute_kw argument shaping", () => {
  it("passes vals_list positionally for create", () => {
    expect(shapeExecuteKw("create", { vals_list: [{ name: "X" }], context: { a: 1 } })).toEqual({
      args: [[{ name: "X" }]],
      kwargs: { context: { a: 1 } },
    });
  });

  it("passes ids and vals positionally for write", () => {
    expect(shapeExecuteKw("write", { ids: [3], vals: { name: "Y" } })).toEqual({
      args: [[3], { name: "Y" }],
      kwargs: {},
    });
  });

  it("keeps search_read entirely in keywords", () => {
    expect(shapeExecuteKw("search_read", { domain: [], fields: ["id"] })).toEqual({
      args: [],
      kwargs: { domain: [], fields: ["id"] },
    });
  });

  it("passes ids first for any other method", () => {
    expect(shapeExecuteKw("action_post", { ids: [9], context: {} })).toEqual({
      args: [[9]],
      kwargs: { context: {} },
    });
  });
});

describe("jsonrpc request shape", () => {
  it("authenticates once then posts execute_kw envelopes", async () => {
    const { server, client } = setupRpc();
    await runWithCorrelation({ requestId: "req-rpc" }, async () => {
      await client.call(
        "res.partner",
        "search_read",
        { domain: [], fields: ["id"] },
        {
          idempotent: true,
        },
      );
      await client.call(
        "res.partner",
        "search_read",
        { domain: [], fields: ["id"] },
        {
          idempotent: true,
        },
      );
    });

    expect(server.authCalls).toBe(1);
    expect(server.calls).toHaveLength(2);
    const call = server.calls[0];
    expect(call?.rpc?.uid).toBe(server.uid);
    expect(call?.rpc?.args).toEqual([]);
    expect(call?.rpc?.kwargs).toEqual({
      domain: [],
      fields: ["id"],
      context: { lfsci_request_id: "req-rpc" },
    });
    expect(call?.headers["X-Request-Id"]).toBe("req-rpc");
    expect(call?.headers.Authorization).toBeUndefined();
  });

  it("refuses a jsonrpc client without a database or a login", () => {
    expect(() => setupRpc({ login: undefined })).toThrowError();
    const error = (() => {
      try {
        setupRpc({ database: undefined });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });

  it("never records the api key in the exchange", async () => {
    const { client, recorder } = setupRpc();
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    const serialised = JSON.stringify(recorder.records);
    expect(serialised).not.toContain("test-api-key");
    expect(serialised).toContain("[redacted]");
  });
});

describe("jsonrpc error mapping", () => {
  it("maps a fault envelope on a 200 to UPSTREAM_REJECTED", async () => {
    const { server, client } = setupRpc({ retry: noRetry });
    server.faultNext({
      code: 200,
      message: "Odoo Server Error",
      data: { name: "odoo.exceptions.UserError", message: "Le partenaire est obligatoire" },
    });
    const error = await expectAppError(client.call("account.move", "create", { vals_list: [{}] }));
    expect(error.code).toBe("UPSTREAM_REJECTED");
    expect(error.details?.name).toBe("odoo.exceptions.UserError");
    expect(error.details?.reason).toBe("jsonrpc_fault");
  });

  it("maps the lock-date fault to PERIOD_LOCKED", async () => {
    const { server, client } = setupRpc({ retry: noRetry });
    server.faultNext({
      code: 200,
      message: "Odoo Server Error",
      data: {
        name: "odoo.exceptions.UserError",
        message: "You cannot add/modify entries prior to and inclusive of the lock date 12/31/2025",
      },
    });
    const error = await expectAppError(client.call("account.move", "action_post", { ids: [1] }));
    expect(error.code).toBe("PERIOD_LOCKED");
  });

  it("maps a wrong api key to UPSTREAM_REJECTED at authentication", async () => {
    const { client } = setupRpc({ apiKey: "wrong-key", retry: noRetry });
    const error = await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("UPSTREAM_REJECTED");
  });

  it("still maps an HTTP 5xx to a retryable UPSTREAM_UNAVAILABLE", async () => {
    const { server, client } = setupRpc();
    server.failNext(503, { name: "werkzeug.exceptions.ServiceUnavailable", message: "down" });
    const rows = await client.call(
      "res.partner",
      "search_read",
      { domain: [], fields: ["id"] },
      { idempotent: true },
    );
    expect(rows).toEqual([]);
  });

  it("re-authenticates once when the session is refused on a read", async () => {
    const { server, client } = setupRpc();
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    expect(server.authCalls).toBe(1);

    server.expireSession();
    const rows = await client.call(
      "res.partner",
      "search_read",
      { domain: [], fields: ["id"] },
      { idempotent: true },
    );
    expect(rows).toEqual([]);
    expect(server.authCalls).toBe(2);
  });

  it("does not re-authenticate a write, which would replay it", async () => {
    const { server, client } = setupRpc({ retry: noRetry });
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    server.expireSession();
    const error = await expectAppError(
      client.call("res.partner", "create", { vals_list: [{ name: "X" }] }),
    );
    expect(error.code).toBe("UPSTREAM_REJECTED");
    expect(server.authCalls).toBe(1);
  });
});

describe("capability snapshot without /doc", () => {
  it("builds the snapshot from fields_get, one call per model", async () => {
    const { server, client } = setupRpc();
    server.handle("res.partner", "fields_get", () => ({ name: { type: "char" }, ref: {} }));
    server.handle("account.move", "fields_get", () => ({ state: { type: "selection" } }));

    const snapshot = await introspectCapabilitySnapshot(client, {
      "res.partner": ["search_read", "create"],
      "account.move": ["search_read", "action_post"],
      "account.missing": ["search_read"],
    });

    expect(snapshot.source).toBe("fields_get");
    expect(snapshot.models?.["res.partner"]?.fields).toEqual(["name", "ref"]);
    expect(() => assertCapability(snapshot, "account.move", "action_post")).not.toThrow();
    expect(() => assertCapability(snapshot, "account.missing", "search_read")).toThrow();
  });
});
