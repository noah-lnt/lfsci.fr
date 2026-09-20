import { describe, expect, it } from "vitest";
import { MailConfig } from "../src/config";
import { createMailer, type ResendLike } from "../src/send";

const config = MailConfig.parse({
  apiKey: "re_test",
  from: "gestion@lfsci.fr",
  replyTo: "contact@lfsci.fr",
  webhookSecret: "whsec_x",
});

type SendArgs = Parameters<ResendLike["emails"]["send"]>;

function fakeResend(
  result: Awaited<ReturnType<ResendLike["emails"]["send"]>>,
  calls: SendArgs[],
): ResendLike {
  return {
    emails: {
      send: ((...args: SendArgs) => {
        calls.push(args);
        return Promise.resolve(result);
      }) as ResendLike["emails"]["send"],
    } as ResendLike["emails"],
  };
}

describe("createMailer", () => {
  it("sends through the SDK with the configured from, replyTo and idempotency key", async () => {
    const calls: SendArgs[] = [];
    const mailer = createMailer({
      config,
      client: fakeResend({ data: { id: "e_42" }, error: null, headers: null }, calls),
    });

    await expect(
      mailer.send({
        to: ["locataire@example.test"],
        subject: "Quittance de septembre",
        text: "Bonjour, voici votre quittance.",
        idempotencyKey: "quittance-2026-09",
      }),
    ).resolves.toEqual({ id: "e_42" });

    expect(calls[0]?.[0]).toMatchObject({
      from: "gestion@lfsci.fr",
      to: ["locataire@example.test"],
      replyTo: "contact@lfsci.fr",
    });
    expect(calls[0]?.[1]).toEqual({ idempotencyKey: "quittance-2026-09" });
  });

  it("maps a provider error to UPSTREAM_REJECTED", async () => {
    const mailer = createMailer({
      config,
      client: fakeResend(
        {
          data: null,
          error: { name: "validation_error", message: "domain not verified", statusCode: 422 },
          headers: null,
        },
        [],
      ),
    });
    await expect(
      mailer.send({ to: ["a@example.test"], subject: "x", text: "y" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_REJECTED" });
  });

  it("refuses an invalid recipient before the call", async () => {
    const calls: SendArgs[] = [];
    const mailer = createMailer({
      config,
      client: fakeResend({ data: { id: "e" }, error: null, headers: null }, calls),
    });
    await expect(
      mailer.send({ to: ["not-an-email"], subject: "x", text: "y" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(calls).toHaveLength(0);
  });
});
