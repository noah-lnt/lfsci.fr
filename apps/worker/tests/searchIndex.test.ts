import type { AiClient, EmbedInput, EmbedResult } from "@lfsci/ai";
import { withTenant } from "@lfsci/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/deps";
import { indexOrganization, indexVectors } from "../src/jobs/searchIndex";
import {
  adminDb,
  appDb,
  closeDbs,
  migrate,
  ORG_ID,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "./db";
import { fakeDeps } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const INTERVENTION_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
const DOCUMENT_ID = "ffffffff-6666-4666-8666-ffffffffffff";
const LINKED_ACTIVITY_ID = "11111111-7777-4777-8777-111111111111";
const ORPHAN_ACTIVITY_ID = "22222222-8888-4888-8888-222222222222";

function aiWith(embed: (input: EmbedInput) => Promise<EmbedResult>): AiClient {
  return {
    provider: "ollama",
    modelId: "qwen3:32b",
    embedModelId: "bge-m3",
    embedDimensions: 1024,
    supportsServerSideFallback: false,
    extract: async () => {
      throw new Error("not used");
    },
    assistant: async () => ({ ok: true, stopReason: "end_turn" }),
    embed,
    health: async () => null,
  };
}

function vector(seed: number): number[] {
  return Array.from({ length: 1024 }, (_, index) => ((index + seed) % 97) / 97);
}

async function seedSources(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO intervention (id, organization_id, title, description, status, observed_result)
    VALUES (${INTERVENTION_ID}::uuid, ${ORG_ID}::uuid, 'Remplacement chaudière',
            'La chaudière gaz du lot A fuyait', 'done', 'Chaudière remplacée')`);
  await db.execute(sql`
    INSERT INTO document (id, organization_id, title, nature)
    VALUES (${DOCUMENT_ID}::uuid, ${ORG_ID}::uuid, 'Facture plombier', 'invoice')`);
  await db.execute(sql`
    INSERT INTO activity (id, organization_id, channel, direction, subject, body_raw, occurred_at)
    VALUES (${LINKED_ACTIVITY_ID}::uuid, ${ORG_ID}::uuid, 'email', 'inbound',
            'Panne de chauffage', 'Le locataire signale une panne', now()),
           (${ORPHAN_ACTIVITY_ID}::uuid, ${ORG_ID}::uuid, 'note', 'internal',
            'Note sans objet', 'Aucun lien', now())`);
  await db.execute(sql`
    INSERT INTO object_ref (id, organization_id, kind, intervention_id)
    VALUES (gen_random_uuid(), ${ORG_ID}::uuid, 'intervention', ${INTERVENTION_ID}::uuid)`);
  await db.execute(sql`
    INSERT INTO activity_link (organization_id, activity_id, object_ref_id, occurred_at)
    SELECT ${ORG_ID}::uuid, ${LINKED_ACTIVITY_ID}::uuid, o.id, now()
      FROM object_ref o WHERE o.intervention_id = ${INTERVENTION_ID}::uuid`);
}

function depsWith(ai: AiClient | null): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb(), ai });
}

async function countRows(table: "search_document" | "embedding"): Promise<number> {
  return withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
    const found = await tx.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM ${sql.raw(table)}`,
    );
    return Number([...found][0]?.n ?? "0");
  });
}

run("search.index against PostgreSQL", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
    await seedSources();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("fills the tsv so a French accented word matches without its accent", async () => {
    const result = await indexOrganization(depsWith(null), ORG_ID);

    expect(result.failedSources).toEqual([]);
    // The orphan activity has no object_ref to point at and is counted, not indexed.
    expect(result.unlinked).toBe(1);
    expect(result.indexed).toBe(3);

    const hits = await withTenant(appDb(), { organizationId: ORG_ID }, async (tx) => {
      const found = await tx.execute<{ source_table: string; source_id: string }>(sql`
        SELECT source_table, source_id FROM search_document
         WHERE tsv @@ plainto_tsquery('french', unaccent('chaudiere'))`);
      return [...found];
    });
    expect(hits.map((row) => row.source_table)).toEqual(["intervention"]);
    expect(hits[0]?.source_id).toBe(INTERVENTION_ID);
  });

  it("is idempotent: a second pass rewrites the same rows and writes no duplicate", async () => {
    await indexOrganization(depsWith(null), ORG_ID);
    const first = await countRows("search_document");
    const second = await indexOrganization(depsWith(null), ORG_ID);

    expect(await countRows("search_document")).toBe(first);
    expect(second.failedSources).toEqual([]);
  });

  it("indexes the text half and leaves no vector when the provider is unreachable", async () => {
    const ai = aiWith(async () => ({
      ok: false,
      reason: "upstream",
      code: "UPSTREAM_UNAVAILABLE",
      detail: "ollama unreachable",
    }));
    const result = await indexOrganization(depsWith(ai), ORG_ID);

    expect(result.indexed).toBe(3);
    expect(result.vectors).toEqual({ embedded: 0, skipped: "upstream" });
    expect(await countRows("search_document")).toBe(3);
    expect(await countRows("embedding")).toBe(0);
  });

  it("writes one vector per indexed row once the provider answers, and stops re-embedding", async () => {
    const ai = aiWith(
      async ({ texts }): Promise<EmbedResult> => ({
        ok: true,
        vectors: texts.map((_, index) => vector(index)),
        modelId: "bge-m3",
        dimensions: 1024,
        usage: { inputTokens: 10, outputTokens: null },
      }),
    );
    const result = await indexOrganization(depsWith(ai), ORG_ID);

    expect(result.vectors.embedded).toBe(3);
    expect(await countRows("embedding")).toBe(3);

    const again = await indexVectors(depsWith(ai), ORG_ID);
    expect(again.embedded).toBe(0);
    expect(await countRows("embedding")).toBe(3);
  });

  it("refuses a vector of the wrong width rather than storing a padded one", async () => {
    const ai = aiWith(async () => ({
      ok: false,
      reason: "dimension_mismatch",
      code: "UPSTREAM_REJECTED",
      detail: "768 dimensions",
    }));
    const result = await indexOrganization(depsWith(ai), ORG_ID);

    expect(result.vectors.skipped).toBe("dimension_mismatch");
    expect(await countRows("embedding")).toBe(0);
  });
});
