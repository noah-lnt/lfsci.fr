import { isAppError, runWithCorrelation } from "@lfsci/kernel";
import { describe, expect, it } from "vitest";
import { noRetry, setup } from "./helpers";

async function expectAppError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!isAppError(error)) throw new Error(`expected an AppError, received ${String(error)}`);
  return error;
}

describe("odoo client request shape", () => {
  it("posts to /json/2/{model}/{method} with the bearer, database and request id", async () => {
    const { server, client } = setup();
    await runWithCorrelation({ requestId: "req-shape" }, () =>
      client.call(
        "res.partner",
        "search_read",
        { domain: [], fields: ["id"] },
        { idempotent: true },
      ),
    );

    const call = server.calls[0];
    expect(call?.model).toBe("res.partner");
    expect(call?.method).toBe("search_read");
    expect(call?.headers.Authorization).toBe("bearer test-api-key");
    expect(call?.headers["Content-Type"]).toBe("application/json");
    expect(call?.headers["X-Request-Id"]).toBe("req-shape");
    expect(call?.headers["X-Odoo-Database"]).toBe("lfsci-test");
    expect(call?.kwargs).toEqual({
      domain: [],
      fields: ["id"],
      context: { lfsci_request_id: "req-shape" },
    });
  });

  it("keeps the caller's context keys beside lfsci_request_id", async () => {
    const { server, client } = setup();
    await runWithCorrelation({ requestId: "req-ctx" }, () =>
      client.call(
        "res.partner",
        "search_read",
        { domain: [], context: { allowed_company_ids: [1] } },
        { idempotent: true },
      ),
    );
    expect(server.calls[0]?.kwargs.context).toEqual({
      allowed_company_ids: [1],
      lfsci_request_id: "req-ctx",
    });
  });

  it("omits the database header when no database is configured", async () => {
    const { server, client } = setup({ database: undefined });
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    expect(server.calls[0]?.headers["X-Odoo-Database"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("spaces two calls by at least one second at the default rate", async () => {
    const { server, client } = setup();
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });

    const [first, second] = server.calls;
    expect(server.calls).toHaveLength(2);
    expect((second?.at ?? 0) - (first?.at ?? 0)).toBeGreaterThanOrEqual(1000);
  });

  it("serialises concurrent calls (concurrency 1) and still spaces them", async () => {
    const { server, client } = setup();
    await Promise.all([
      client.call(
        "res.partner",
        "search_read",
        { domain: [], fields: ["id"] },
        { idempotent: true },
      ),
      client.call("account.journal", "search_read", { domain: [] }, { idempotent: true }),
      client.call("account.move", "search_read", { domain: [] }, { idempotent: true }),
    ]);
    expect(server.calls.map((call) => call.model)).toEqual([
      "res.partner",
      "account.journal",
      "account.move",
    ]);
    expect(server.calls.map((call) => call.at)).toEqual([0, 1000, 2000]);
  });

  it("does not space calls when the limiter is disabled (ratePerSecond 0)", async () => {
    const { server, client } = setup({ ratePerSecond: 0 });
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    await client.call("res.partner", "search_read", { domain: [] }, { idempotent: true });
    expect(server.calls.map((call) => call.at)).toEqual([0, 0]);
  });
});

describe("error mapping", () => {
  it("maps a 5xx to UPSTREAM_UNAVAILABLE", async () => {
    const { server, client } = setup({ retry: noRetry });
    server.failNext(502, { name: "werkzeug.exceptions.BadGateway", message: "bad gateway" });
    const error = await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("maps a 401 to UPSTREAM_REJECTED and keeps the Odoo exception name", async () => {
    const { client } = setup({ apiKey: "wrong-key", retry: noRetry });
    const error = await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("UPSTREAM_REJECTED");
    expect(error.details?.name).toBe("werkzeug.exceptions.Unauthorized");
  });

  it("maps a 403 AccessError to UPSTREAM_REJECTED", async () => {
    const { server, client } = setup({ retry: noRetry });
    server.failNext(403, {
      name: "odoo.exceptions.AccessError",
      message: "You are not allowed to access 'Journal Entry'",
    });
    const error = await expectAppError(
      client.call("account.move", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("UPSTREAM_REJECTED");
    expect(error.details?.name).toBe("odoo.exceptions.AccessError");
  });

  it("maps a 429 to QUOTA_EXCEEDED", async () => {
    const { server, client } = setup({ retry: noRetry });
    server.failNext(429, { name: "werkzeug.exceptions.TooManyRequests", message: "slow down" });
    const error = await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("QUOTA_EXCEEDED");
  });

  it("maps a business UserError to UPSTREAM_REJECTED", async () => {
    const { server, client } = setup({ retry: noRetry });
    server.failNext(400, {
      name: "odoo.exceptions.UserError",
      message: "The partner is required on a vendor bill",
      arguments: ["The partner is required on a vendor bill"],
    });
    const error = await expectAppError(client.call("account.move", "create", { vals_list: [{}] }));
    expect(error.code).toBe("UPSTREAM_REJECTED");
  });

  it("maps the lock-date wording to PERIOD_LOCKED", async () => {
    const { server, client } = setup({ retry: noRetry });
    server.failNext(400, {
      name: "odoo.exceptions.UserError",
      message: "You cannot add/modify entries prior to and inclusive of the lock date 12/31/2025",
      arguments: [],
    });
    const error = await expectAppError(client.call("account.move", "action_post", { ids: [1] }));
    expect(error.code).toBe("PERIOD_LOCKED");
  });

  it("maps a network failure to UPSTREAM_UNAVAILABLE", async () => {
    const { client } = setup({
      retry: noRetry,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    const error = await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(error.details?.reason).toBe("network");
  });

  it("maps a timeout on an idempotent read to UPSTREAM_UNAVAILABLE", async () => {
    const { server, client } = setup({ retry: noRetry, timeoutMs: 25 });
    server.dropNextResponse();
    const error = await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(error.details?.reason).toBe("timeout");
  });

  it("maps a timeout on a write to RESULT_UNKNOWN", async () => {
    const { server, client } = setup({ timeoutMs: 25 });
    server.dropNextResponse();
    const error = await expectAppError(
      client.call("res.partner", "create", { vals_list: [{ name: "X" }] }),
    );
    expect(error.code).toBe("RESULT_UNKNOWN");
  });
});

describe("retry", () => {
  it("retries a transport failure on an idempotent read", async () => {
    const { server, client } = setup();
    server.failNext(503, { name: "werkzeug.exceptions.ServiceUnavailable", message: "down" });
    const rows = await client.call(
      "res.partner",
      "search_read",
      { domain: [], fields: ["id"] },
      { idempotent: true },
    );
    expect(rows).toEqual([]);
    expect(server.calls).toHaveLength(2);
  });

  it("never retries a write", async () => {
    const { server, client } = setup();
    server.failNext(503, { name: "werkzeug.exceptions.ServiceUnavailable", message: "down" });
    const error = await expectAppError(
      client.call("res.partner", "create", { vals_list: [{ name: "X" }] }),
    );
    expect(error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(server.calls).toHaveLength(1);
  });

  it("never retries a business rejection", async () => {
    const { server, client } = setup();
    server.failNext(400, { name: "odoo.exceptions.ValidationError", message: "nope" });
    await expectAppError(
      client.call("res.partner", "search_read", { domain: [] }, { idempotent: true }),
    );
    expect(server.calls).toHaveLength(1);
  });
});
