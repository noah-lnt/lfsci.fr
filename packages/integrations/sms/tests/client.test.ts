import { describe, expect, it } from "vitest";
import { createSmsClient } from "../src/client";
import { SmsConfig } from "../src/config";
import type { FetchLike } from "../src/http";

const config = SmsConfig.parse({ apiKey: "sk_test", sender: "LFSCI" });
const longCode = SmsConfig.parse({
  apiKey: "sk_test",
  sender: "33757000000",
  senderIsLongCode: true,
});

type Call = { url: string; init: RequestInit };

function fake(response: () => Response, calls: Call[]): FetchLike {
  return (async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  }) as FetchLike;
}

describe("sendSms", () => {
  it("posts the normalised recipient to /sms/v1/messages with the api key header", async () => {
    const calls: Call[] = [];
    const client = createSmsClient({
      config,
      fetch: fake(() => Response.json({ messageId: "m-1" }), calls),
    });

    await expect(client.sendSms({ to: "06 12 34 56 78", text: "Loyer reçu." })).resolves.toEqual({
      providerMessageId: "m-1",
      to: "+33612345678",
    });

    expect(calls[0]?.url).toBe("https://rest.smsmode.com/sms/v1/messages");
    expect(((calls[0]?.init.headers ?? {}) as Record<string, string>)["X-Api-Key"]).toBe("sk_test");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      recipient: { to: "+33612345678" },
      body: { text: "Loyer reçu." },
      from: "LFSCI",
    });
  });

  it("refuses a landline before any HTTP call", async () => {
    const calls: Call[] = [];
    const client = createSmsClient({
      config,
      fetch: fake(() => Response.json({ id: "m" }), calls),
    });
    await expect(client.sendSms({ to: "01 45 67 89 01", text: "x" })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { reason: "not_mobile" },
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a reply-expecting message from an alphanumeric sender", async () => {
    const calls: Call[] = [];
    const client = createSmsClient({
      config,
      fetch: fake(() => Response.json({ id: "m" }), calls),
    });
    await expect(
      client.sendSms({ to: "0612345678", text: "Répondez OUI", expectsReply: true }),
    ).rejects.toMatchObject({ code: "RULE_VIOLATION" });
    expect(calls).toHaveLength(0);
    const ok = createSmsClient({
      config: longCode,
      fetch: fake(() => Response.json({ id: "m" }), calls),
    });
    await expect(
      ok.sendSms({ to: "0612345678", text: "Répondez OUI", expectsReply: true }),
    ).resolves.toBeDefined();
  });

  it("maps 429 to QUOTA_EXCEEDED and a send timeout to RESULT_UNKNOWN", async () => {
    const throttled = createSmsClient({
      config,
      fetch: fake(() => new Response("slow down", { status: 429 }), []),
    });
    await expect(throttled.sendSms({ to: "0612345678", text: "x" })).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    const timedOut = createSmsClient({
      config,
      fetch: (() =>
        Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))) as FetchLike,
    });
    await expect(timedOut.sendSms({ to: "0612345678", text: "x" })).rejects.toMatchObject({
      code: "RESULT_UNKNOWN",
    });
  });

  it("parses an inbound SDA message", () => {
    const client = createSmsClient({ config, fetch: fake(() => Response.json({}), []) });
    expect(
      client.parseInbound({
        messageId: "mo-9",
        from: "+33612345678",
        to: "+33757000000",
        text: "OUI",
        receivedAt: "2026-09-20T06:00:00Z",
      }),
    ).toEqual({
      providerMessageId: "mo-9",
      from: "+33612345678",
      to: "+33757000000",
      text: "OUI",
      receivedAt: "2026-09-20T06:00:00Z",
    });
    expect(() => client.parseInbound({ from: "x" })).toThrow(/unexpected smsmode/);
  });
});
