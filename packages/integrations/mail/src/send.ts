import { AppError, logger } from "@lfsci/kernel";
import type { Resend } from "resend";
import { z } from "zod";
import type { MailConfig } from "./config";

const SERVICE = "resend";
const log = logger(SERVICE);

export type ResendLike = Pick<Resend, "emails">;

export const OutboundEmail = z.object({
  to: z.array(z.email()).min(1),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1).optional(),
  replyTo: z.email().optional(),
  idempotencyKey: z.string().min(1).optional(),
  attachments: z
    .array(z.object({ filename: z.string().min(1), content: z.instanceof(Uint8Array) }))
    .optional(),
});
export type OutboundEmail = z.infer<typeof OutboundEmail>;

export type Mailer = { send(email: OutboundEmail): Promise<{ id: string }> };

export function createMailer(input: { config: MailConfig; client: ResendLike }): Mailer {
  const { config, client } = input;

  return {
    async send(email) {
      const parsed = OutboundEmail.safeParse(email);
      if (!parsed.success) {
        throw new AppError("VALIDATION", {
          message: "invalid outbound email",
          details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
        });
      }
      const payload = parsed.data;
      const replyTo = payload.replyTo ?? config.replyTo;

      const result = await client.emails.send(
        {
          from: config.from,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          ...(payload.html ? { html: payload.html } : {}),
          ...(replyTo ? { replyTo } : {}),
          ...(payload.attachments
            ? {
                attachments: payload.attachments.map((a) => ({
                  filename: a.filename,
                  content: Buffer.from(a.content),
                })),
              }
            : {}),
        },
        payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : undefined,
      );

      if (result.error) {
        throw new AppError("UPSTREAM_REJECTED", {
          message: "resend refused the message",
          details: { service: SERVICE, name: result.error.name, reason: result.error.message },
        });
      }
      if (!result.data) {
        throw new AppError("RESULT_UNKNOWN", {
          message: "resend answered without an email id",
          details: { service: SERVICE },
        });
      }
      log.debug({ emailId: result.data.id }, "email sent");
      return { id: result.data.id };
    },
  };
}
