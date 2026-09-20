import { describe, expect, it } from "vitest";
import { MailConfig } from "../src/config";
import type { FetchLike } from "../src/http";
import { createInboundReader, parseInboundEvent } from "../src/inbound";

const config = MailConfig.parse({
  apiKey: "re_test",
  from: "gestion@lfsci.fr",
  webhookSecret: "whsec_x",
});

describe("inbound", () => {
  it("parses an email.received event carrying metadata only", () => {
    const event = parseInboundEvent({
      type: "email.received",
      created_at: "2026-09-20T06:00:00.000Z",
      data: {
        email_id: "e_1",
        from: "locataire@example.test",
        to: ["inbound@lfsci.fr"],
        subject: "Fuite",
      },
    });
    expect(event.data.email_id).toBe("e_1");
  });

  it("rejects an event of another type", () => {
    expect(() => parseInboundEvent({ type: "email.sent", created_at: "x", data: {} })).toThrow(
      /unexpected resend-receiving/,
    );
  });

  it("fetches the body through the Receiving API with the bearer key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reader = createInboundReader({
      config,
      fetch: (async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Response.json({
          id: "e_1",
          from: "a@example.test",
          to: ["inbound@lfsci.fr"],
          text: "Bonjour",
        });
      }) as FetchLike,
    });

    await expect(reader.getInboundEmail("e_1")).resolves.toMatchObject({
      id: "e_1",
      text: "Bonjour",
    });
    expect(calls[0]?.url).toBe("https://api.resend.com/emails/receiving/e_1");
    expect(((calls[0]?.init.headers ?? {}) as Record<string, string>).authorization).toBe(
      "Bearer re_test",
    );
  });

  it("downloads an attachment and maps 404 to UPSTREAM_REJECTED", async () => {
    const reader = createInboundReader({
      config,
      fetch: (async (input) =>
        String(input).endsWith("/att_1")
          ? new Response(Uint8Array.from([1, 2, 3]))
          : new Response("missing", { status: 404 })) as FetchLike,
    });
    await expect(reader.getInboundAttachment("e_1", "att_1")).resolves.toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    await expect(reader.getInboundAttachment("e_1", "att_2")).rejects.toMatchObject({
      code: "UPSTREAM_REJECTED",
    });
  });
});
