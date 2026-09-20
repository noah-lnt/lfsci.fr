import { describe, expect, it } from "vitest";
import { MailConfig } from "../src/config";
import { createHttpMailer, RESEND_SEND_EMAIL_PATH } from "../src/send-http";

const config = MailConfig.parse({
  apiKey: "re_test",
  from: "gestion@lfsci.fr",
  replyTo: "contact@lfsci.fr",
  webhookSecret: "whsec_x",
});

type Call = { url: string; init: RequestInit };

function fakeFetch(
  respond: (call: Call) => Response | Promise<Response> | never,
  calls: Call[] = [],
): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpMailer", () => {
  it("posts to the send endpoint and carries the dedup key as the idempotency key", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { id: "e_1" }));
    const mailer = createHttpMailer({ config, fetch });

    await expect(
      mailer.send({
        to: ["locataire@example.test"],
        subject: "Loyer en attente",
        text: "Bonjour,",
        idempotencyKey: "reminder:lease:reminder_1:2026-09-05",
      }),
    ).resolves.toEqual({ id: "e_1" });

    const call = calls[0];
    expect(call?.url).toBe(`https://api.resend.com${RESEND_SEND_EMAIL_PATH}`);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("reminder:lease:reminder_1:2026-09-05");
    expect(JSON.parse(String(call?.init.body))).toMatchObject({
      from: "gestion@lfsci.fr",
      to: ["locataire@example.test"],
      reply_to: "contact@lfsci.fr",
    });
  });

  it("refuses an invalid recipient before spending a call", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { id: "e_never" }));
    const mailer = createHttpMailer({ config, fetch });
    await expect(
      mailer.send({ to: ["pas-une-adresse"], subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls).toHaveLength(0);
  });

  it("maps a refused recipient to a terminal UPSTREAM_REJECTED", async () => {
    const { fetch } = fakeFetch(() =>
      json(422, { name: "validation_error", message: "Invalid `to` field" }),
    );
    const mailer = createHttpMailer({ config, fetch });
    await expect(
      mailer.send({ to: ["locataire@example.test"], subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_REJECTED" });
  });

  it("maps a provider outage to a retryable UPSTREAM_UNAVAILABLE", async () => {
    const { fetch } = fakeFetch(() => json(503, { message: "service unavailable" }));
    const mailer = createHttpMailer({ config, fetch });
    await expect(
      mailer.send({ to: ["locataire@example.test"], subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("maps a rate limit to QUOTA_EXCEEDED rather than a rejection", async () => {
    const { fetch } = fakeFetch(() => json(429, { message: "too many requests" }));
    const mailer = createHttpMailer({ config, fetch });
    await expect(
      mailer.send({ to: ["locataire@example.test"], subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});
