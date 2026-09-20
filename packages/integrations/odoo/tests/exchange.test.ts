import { runWithCorrelation } from "@lfsci/kernel";
import { createOdooOperations } from "@lfsci/odoo";
import { describe, expect, it } from "vitest";
import { noRetry, setup } from "./helpers";

describe("exchange recorder", () => {
  it("records one redacted exchange per call, without the api key", async () => {
    const { server, client, recorder } = setup();
    server.seed("res.partner", [{ name: "Alpha", ref: "F-001" }]);

    await runWithCorrelation({ requestId: "req-exchange" }, () =>
      client.call(
        "res.partner",
        "search_read",
        { domain: [], fields: ["id"] },
        { idempotent: true },
      ),
    );

    expect(recorder.records).toHaveLength(1);
    const exchange = recorder.records[0];
    expect(exchange?.requestId).toBe("req-exchange");
    expect(exchange?.model).toBe("res.partner");
    expect(exchange?.method).toBe("search_read");
    expect(exchange?.status).toBe(200);
    const request = exchange?.request as { headers: Record<string, string>; url: string };
    expect(request.headers.Authorization).toBe("[redacted]");
    expect(request.url).toBe("https://odoo.test/json/2/res.partner/search_read");
    expect(JSON.stringify(recorder.records)).not.toContain("test-api-key");
  });

  it("redacts the attachment payload and the iban in a recorded body", async () => {
    const { client, recorder } = setup();
    const operations = createOdooOperations(client);
    await operations.attachDocument({
      name: "rib FR7630001007941234567890185.pdf",
      base64: "c2VjcmV0LWJhc2U2NA==",
      resModel: "account.move",
      resId: 1,
    });
    const serialized = JSON.stringify(recorder.records);
    expect(serialized).not.toContain("c2VjcmV0LWJhc2U2NA==");
    expect(serialized).not.toContain("FR7630001007941234567890185");
    expect(serialized).toContain("[redacted]");
  });

  it("records a failed exchange with its status", async () => {
    const { server, client, recorder } = setup({ retry: noRetry });
    server.failNext(429, { name: "werkzeug.exceptions.TooManyRequests", message: "slow down" });
    await client
      .call("res.partner", "search_read", { domain: [] }, { idempotent: true })
      .catch(() => undefined);
    expect(recorder.records[0]?.status).toBe(429);
  });
});
