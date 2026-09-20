import "server-only";
import { logger } from "@lfsci/kernel";
import { assistantClient } from "../assistant/client";

const log = logger("recherche.embed");

export type QueryVector = { modelName: string; literal: string };

export type QueryEmbedding = { ok: true; vector: QueryVector } | { ok: false; reason: string };

/**
 * The provider is regularly unreachable (a local model on the owner's box), so a
 * failure here is a missing half, never an error: the caller answers on the text
 * index alone and the screen says the meaning half was not used.
 */
export async function embedQuery(query: string, requestId: string): Promise<QueryEmbedding> {
  const client = assistantClient();
  if (!client) return { ok: false, reason: "ai_unconfigured" };
  if (!client.embedModelId) return { ok: false, reason: "provider_has_no_embeddings" };

  try {
    const result = await client.embed({ texts: [query], requestId });
    if (!result.ok) return { ok: false, reason: result.reason };
    const vector = result.vectors[0];
    if (!vector) return { ok: false, reason: "upstream" };
    return { ok: true, vector: { modelName: result.modelId, literal: `[${vector.join(",")}]` } };
  } catch (error) {
    log.warn({ err: error }, "query embedding unavailable, answering on the text index alone");
    return { ok: false, reason: "upstream" };
  }
}
