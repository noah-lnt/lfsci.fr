import { describe, expect, it } from "vitest";
import { signResendWebhook, verifyResendWebhook } from "../src/webhook";

const secret = `whsec_${Buffer.from("lfsci-inbound-secret").toString("base64")}`;
const id = "msg_2p3q";
const timestamp = 1_790_000_000;
const rawBody = JSON.stringify({ type: "email.received", data: { email_id: "e_1" } });
const now = new Date(timestamp * 1000);

function headers(signature: string): Record<string, string> {
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": signature };
}

describe("verifyResendWebhook", () => {
  const valid = signResendWebhook({ id, timestamp, rawBody, secret });

  it("accepts a valid signature and returns the parsed payload", () => {
    const result = verifyResendWebhook({ headers: headers(valid), rawBody, secret, now });
    expect(result.id).toBe(id);
    expect(result.payload).toEqual(JSON.parse(rawBody));
  });

  it("accepts a space-separated list containing the valid signature", () => {
    const result = verifyResendWebhook({
      headers: headers(`v1,AAAA v2,BBBB ${valid}`),
      rawBody,
      secret,
      now,
    });
    expect(result.timestamp).toBe(timestamp);
  });

  it("refuses a tampered body", () => {
    expect(() =>
      verifyResendWebhook({ headers: headers(valid), rawBody: `${rawBody} `, secret, now }),
    ).toThrow(/signature mismatch/);
  });

  it("refuses a timestamp older than the 5-minute tolerance", () => {
    expect(() =>
      verifyResendWebhook({
        headers: headers(valid),
        rawBody,
        secret,
        now: new Date((timestamp + 301) * 1000),
      }),
    ).toThrow(/tolerance/);
  });

  it("refuses missing headers", () => {
    expect(() => verifyResendWebhook({ headers: {}, rawBody, secret, now })).toThrow(
      /missing svix/,
    );
  });
});
