import { logger, REQUEST_ID_HEADER, requestIdFromHeader } from "@lfsci/kernel";
import { smsmodeV1Adapter } from "@lfsci/sms";
import { secretMatches, sentSecret } from "@/server/inbox/secret";
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

const log = logger("webhook.smsmode");
export const SECRET_HEADER = "x-smsmode-secret";

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFromHeader(request.headers.get(REQUEST_ID_HEADER));
  const answer = (status: number, body: Record<string, unknown>): Response =>
    Response.json({ ...body, requestId }, { status, headers: { [REQUEST_ID_HEADER]: requestId } });

  const secret = process.env.SMSMODE_WEBHOOK_SECRET;
  if (!secret) {
    log.error({ requestId }, "SMSMODE_WEBHOOK_SECRET is not set");
    return answer(503, { status: "unconfigured" });
  }
  if (!secretMatches(sentSecret(request, SECRET_HEADER), secret)) {
    log.warn({ requestId }, "smsmode webhook secret rejected");
    return answer(401, { status: "unauthorized" });
  }

  const payload: unknown = await request.json().catch(() => null);
  const organizationId = await resolveWebhookOrganization();

  const message = (() => {
    try {
      const parsed = smsmodeV1Adapter.parseInbound(payload);
      return parsed.providerMessageId === "" ? null : parsed;
    } catch {
      return null;
    }
  })();

  if (!message) {
    await inTenant(organizationId, requestId, async (tx) => {
      await quarantine(tx, organizationId, {
        source: "sms_paste",
        providerId: null,
        reason: "unparseable inbound sms",
      });
      await logExchange(tx, {
        organizationId,
        requestId,
        integration: "smsmode",
        operation: "sms.inbound",
        request: {},
        status: "rejected",
        httpStatus: 202,
      });
    });
    return answer(202, { status: "quarantined" });
  }

  const duplicate = await inTenant(organizationId, requestId, async (tx) => {
    const seen = await alreadySeen(tx, "sms", message.providerMessageId);
    await logExchange(tx, {
      organizationId,
      requestId,
      integration: "smsmode",
      operation: "sms.inbound",
      request: { providerMessageId: message.providerMessageId, from: message.from },
      status: "success",
      httpStatus: 202,
    });
    return seen;
  });
  if (duplicate) {
    return answer(200, { status: "duplicate", providerMessageId: message.providerMessageId });
  }

  const jobId = await enqueueJob("inbound.sms", { organizationId, payload });
  return answer(202, {
    status: "accepted",
    providerMessageId: message.providerMessageId,
    queued: jobId !== null,
  });
}

export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405 });
}
