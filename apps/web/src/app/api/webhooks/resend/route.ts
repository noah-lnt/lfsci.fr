import { logger, REQUEST_ID_HEADER, requestIdFromHeader } from "@lfsci/kernel";
import { parseInboundEvent, verifyResendWebhook } from "@lfsci/mail";
import {
  alreadySeen,
  inTenant,
  logExchange,
  quarantine,
  resolveWebhookOrganization,
} from "@/server/inbox/webhooks";
import { enqueueJob } from "@/server/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("webhook.resend");

function headerBag(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFromHeader(request.headers.get(REQUEST_ID_HEADER));
  const answer = (status: number, body: Record<string, unknown>): Response =>
    Response.json({ ...body, requestId }, { status, headers: { [REQUEST_ID_HEADER]: requestId } });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    log.error({ requestId }, "RESEND_WEBHOOK_SECRET is not set");
    return answer(503, { status: "unconfigured" });
  }

  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = verifyResendWebhook({ headers: headerBag(request.headers), rawBody, secret }).payload;
  } catch {
    // Never log the body of an unverified message (INT-01).
    log.warn({ requestId }, "resend webhook signature rejected");
    return answer(401, { status: "unauthorized" });
  }

  const organizationId = await resolveWebhookOrganization();
  const type = (payload as { type?: unknown } | null)?.type;

  const parsed = (() => {
    try {
      return parseInboundEvent(payload);
    } catch {
      return null;
    }
  })();

  if (!parsed) {
    await inTenant(organizationId, requestId, async (tx) => {
      await quarantine(tx, organizationId, {
        source: "email_forward",
        providerId: null,
        reason: typeof type === "string" ? `unsupported event ${type}` : "unparseable payload",
      });
      await logExchange(tx, {
        organizationId,
        requestId,
        integration: "resend",
        operation: "email.received",
        request: { type },
        status: "rejected",
        httpStatus: 202,
      });
    });
    return answer(202, { status: "quarantined" });
  }

  const emailId = parsed.data.email_id;
  const duplicate = await inTenant(organizationId, requestId, async (tx) => {
    const seen = await alreadySeen(tx, "email", emailId);
    await logExchange(tx, {
      organizationId,
      requestId,
      integration: "resend",
      operation: "email.received",
      request: { emailId, to: parsed.data.to },
      status: "success",
      httpStatus: 202,
    });
    return seen;
  });
  if (duplicate) return answer(200, { status: "duplicate", emailId });

  const jobId = await enqueueJob("inbound.email", { organizationId, emailId });
  return answer(202, { status: "accepted", emailId, queued: jobId !== null });
}

export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405 });
}
