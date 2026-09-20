import { runAssistantTurn } from "@lfsci/ai";
import { messageByCode } from "@lfsci/contracts";
import { logger, REQUEST_ID_HEADER, requestIdFromHeader, runWithCorrelation } from "@lfsci/kernel";
import { z } from "zod";
import { assistantClient } from "@/server/assistant/client";
import { createAssistantPorts } from "@/server/assistant/ports";
import { createEventMapper, encodeEvent, errorEvent } from "@/server/assistant/sse";
import { auth } from "@/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = logger("assistant.route");

const Body = z.object({
  message: z.string().min(1).max(8000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
    .max(40)
    .default([]),
});

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

function singleFrame(
  requestId: string,
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "UPSTREAM_UNAVAILABLE",
  message?: string,
): Response {
  const frame = encodeEvent(
    errorEvent({ code, message: message ?? messageByCode[code], requestId }),
  );
  return new Response(frame, {
    status: 200,
    headers: { ...SSE_HEADERS, [REQUEST_ID_HEADER]: requestId },
  });
}

export async function POST(request: Request): Promise<Response> {
  const requestId = requestIdFromHeader(request.headers.get(REQUEST_ID_HEADER));

  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return singleFrame(requestId, "UNAUTHENTICATED");
  const organizationId =
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  if (!organizationId) return singleFrame(requestId, "FORBIDDEN");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return singleFrame(requestId, "VALIDATION");

  const ai = assistantClient();
  if (!ai) {
    return singleFrame(
      requestId,
      "UPSTREAM_UNAVAILABLE",
      "L’assistant n’est pas configuré sur cet environnement : aucune clé de modèle n’est disponible.",
    );
  }

  const scope = { requestId, session, organizationId };
  const collector = createAssistantPorts(scope);
  const mapper = createEventMapper();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (frame: string): void => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch (error) {
          log.warn({ err: error, requestId }, "assistant frame dropped");
        }
      };

      void runWithCorrelation({ requestId, organizationId, actorId: session.user.id }, async () => {
        try {
          await runAssistantTurn({
            ai,
            ports: collector.ports,
            history: parsed.data.history,
            userMessage: parsed.data.message,
            organizationId,
            onEvent: (event) => {
              mapper.addSources(collector.takeSources());
              mapper.setProposedCommand(collector.proposedCommandId());
              const wire = mapper.map(event);
              if (wire) emit(encodeEvent(wire));
            },
          });
        } catch (error) {
          log.error({ err: error, requestId }, "assistant turn failed");
          emit(
            encodeEvent(
              errorEvent({
                code: "UPSTREAM_UNAVAILABLE",
                message: messageByCode.UPSTREAM_UNAVAILABLE,
                requestId,
              }),
            ),
          );
        } finally {
          controller.close();
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { ...SSE_HEADERS, [REQUEST_ID_HEADER]: requestId },
  });
}
