import { ensureObjectRef, type Tx, tables, withTenant } from "@lfsci/db";
import { currentRequestId, logger } from "@lfsci/kernel";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.search.index");

export const CONNECTOR = "search";
export const TEXT_BATCH_SIZE = 200;
export const OVERLAP_SECONDS = 300;
/** One /api/embed call per batch; the run stops after this many so a pass stays bounded. */
export const EMBED_BATCH_SIZE = 16;
export const EMBED_BATCHES_PER_RUN = 8;
export const MAX_CHUNK_CHARS = 4000;
/** Postgres has no `french` dictionary entry for accents; `unaccent` is installed by 0001. */
export const SEARCH_LANGUAGE = "french";

export const SearchIndexData = JobBase.extend({});
export type SearchIndexData = z.infer<typeof SearchIndexData>;

export type IndexRow = {
  sourceId: string;
  objectRefId: string | null;
  title: string | null;
  body: string | null;
  changedAt: string;
};

/** MEM-01: documents, activities, events and interventions. */
export const SOURCE_TABLES = ["document", "activity", "event", "intervention"] as const;
export type SourceTable = (typeof SOURCE_TABLES)[number];

const EPOCH = "1970-01-01T00:00:00.000+00:00";

function rows<T extends Record<string, unknown>>(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<T[]> {
  return tx.execute<T>(query).then((result) => [...result] as T[]);
}

type RawRow = {
  source_id: string;
  object_ref_id: string | null;
  title: string | null;
  body: string | null;
  changed_at: string;
};

const CHANGED_AT = sql.raw(
  `to_char(COALESCE(t.updated_at, t.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00')`,
);

async function selectSource(tx: Tx, table: SourceTable, since: string): Promise<IndexRow[]> {
  const queries: Record<SourceTable, ReturnType<typeof sql>> = {
    // The OCR text itself lives in object storage; what the database holds as text
    // is the document's own metadata plus the extracted field values.
    document: sql`SELECT t.id AS source_id, o.id AS object_ref_id, t.title,
        concat_ws(' ', t.nature, (
          SELECT string_agg(x.proposed_value, ' ')
            FROM ai_extraction x
            JOIN document_version dv ON dv.id = x.source_document_version_id
           WHERE dv.document_id = t.id AND x.decision <> 'rejected'
             AND x.proposed_value IS NOT NULL)) AS body,
        ${CHANGED_AT} AS changed_at
      FROM document t
      LEFT JOIN object_ref o ON o.kind = 'document' AND o.document_id = t.id
     WHERE COALESCE(t.updated_at, t.created_at) >= ${since}::timestamptz
       AND t.purged_at IS NULL
     ORDER BY COALESCE(t.updated_at, t.created_at)
     LIMIT ${TEXT_BATCH_SIZE}`,
    activity: sql`SELECT t.id AS source_id,
        (SELECT l.object_ref_id FROM activity_link l
          WHERE l.activity_id = t.id ORDER BY l.created_at LIMIT 1) AS object_ref_id,
        t.subject AS title, t.body_raw AS body, ${CHANGED_AT} AS changed_at
      FROM activity t
     WHERE COALESCE(t.updated_at, t.created_at) >= ${since}::timestamptz
     ORDER BY COALESCE(t.updated_at, t.created_at)
     LIMIT ${TEXT_BATCH_SIZE}`,
    event: sql`SELECT t.id AS source_id, t.primary_object_ref_id AS object_ref_id,
        t.type AS title, concat_ws(' ', t.actor_label, t.payload::text) AS body,
        ${CHANGED_AT} AS changed_at
      FROM event t
     WHERE COALESCE(t.updated_at, t.created_at) >= ${since}::timestamptz
     ORDER BY COALESCE(t.updated_at, t.created_at)
     LIMIT ${TEXT_BATCH_SIZE}`,
    intervention: sql`SELECT t.id AS source_id, o.id AS object_ref_id, t.title,
        concat_ws(' ', t.description, t.observed_result) AS body, ${CHANGED_AT} AS changed_at
      FROM intervention t
      LEFT JOIN object_ref o ON o.kind = 'intervention' AND o.intervention_id = t.id
     WHERE COALESCE(t.updated_at, t.created_at) >= ${since}::timestamptz
     ORDER BY COALESCE(t.updated_at, t.created_at)
     LIMIT ${TEXT_BATCH_SIZE}`,
  };

  const found = await rows<RawRow>(tx, queries[table]);
  return found.map((row) => ({
    sourceId: row.source_id,
    objectRefId: row.object_ref_id,
    title: row.title,
    body: row.body,
    changedAt: row.changed_at,
  }));
}

const OBJECT_KIND_BY_TABLE: Partial<Record<SourceTable, "document" | "intervention">> = {
  document: "document",
  intervention: "intervention",
};

/**
 * `search_document.object_ref_id` is NOT NULL. A document or an intervention gets
 * its registry row created on the spot; an activity with no link has nothing to
 * point at, so it is counted as unlinked rather than indexed under a wrong object.
 */
async function resolveObjectRef(
  tx: Tx,
  organizationId: string,
  table: SourceTable,
  row: IndexRow,
): Promise<string | null> {
  if (row.objectRefId) return row.objectRefId;
  const kind = OBJECT_KIND_BY_TABLE[table];
  if (!kind) return null;
  return ensureObjectRef(tx, { organizationId, kind, id: row.sourceId });
}

export function chunkTextOf(row: { title: string | null; body: string | null }): string {
  return [row.title, row.body]
    .filter((part) => part && part.trim().length > 0)
    .join("\n")
    .slice(0, MAX_CHUNK_CHARS);
}

async function upsertSearchDocument(
  tx: Tx,
  organizationId: string,
  table: SourceTable,
  objectRefId: string,
  row: IndexRow,
): Promise<void> {
  const text = chunkTextOf(row);
  await tx.execute(sql`
    INSERT INTO search_document
      (organization_id, object_ref_id, source_table, source_id, title, body, tsv, language, indexed_at)
    VALUES (${organizationId}::uuid, ${objectRefId}::uuid, ${table}, ${row.sourceId}::uuid,
            ${row.title}, ${row.body},
            to_tsvector(${SEARCH_LANGUAGE}::regconfig, unaccent(${text})), ${SEARCH_LANGUAGE}, now())
    ON CONFLICT (organization_id, source_table, source_id) DO UPDATE SET
      object_ref_id = EXCLUDED.object_ref_id,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      tsv = EXCLUDED.tsv,
      indexed_at = now(),
      updated_at = now(),
      version = search_document.version + 1`);
}

export type TextPassResult = { indexed: number; unlinked: number; lastChangedAt: string | null };

export async function indexTextForSource(
  deps: Deps,
  organizationId: string,
  table: SourceTable,
  since: string,
): Promise<TextPassResult> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const found = await selectSource(tx, table, since);
    let indexed = 0;
    let unlinked = 0;
    let lastChangedAt: string | null = null;
    for (const row of found) {
      const objectRefId = await resolveObjectRef(tx, organizationId, table, row);
      if (!objectRefId) {
        unlinked += 1;
        lastChangedAt = row.changedAt;
        continue;
      }
      await upsertSearchDocument(tx, organizationId, table, objectRefId, row);
      indexed += 1;
      lastChangedAt = row.changedAt;
    }
    return { indexed, unlinked, lastChangedAt };
  });
}

type PendingVector = {
  objectRefId: string;
  sourceTable: string;
  sourceId: string;
  chunkText: string;
};

async function pendingVectors(
  deps: Deps,
  organizationId: string,
  modelName: string,
  limit: number,
): Promise<PendingVector[]> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const found = await rows<{
      object_ref_id: string;
      source_table: string;
      source_id: string;
      title: string | null;
      body: string | null;
    }>(
      tx,
      sql`SELECT s.object_ref_id, s.source_table, s.source_id, s.title, s.body
            FROM search_document s
            LEFT JOIN embedding e
              ON e.organization_id = s.organization_id AND e.source_table = s.source_table
             AND e.source_id = s.source_id AND e.chunk_index = 0 AND e.model_name = ${modelName}
           WHERE e.id IS NULL OR COALESCE(e.updated_at, e.created_at) < s.indexed_at
           ORDER BY s.indexed_at
           LIMIT ${limit}`,
    );
    return found.map((row) => ({
      objectRefId: row.object_ref_id,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      chunkText: chunkTextOf({ title: row.title, body: row.body }),
    }));
  });
}

async function writeVectors(
  deps: Deps,
  organizationId: string,
  modelName: string,
  dimensions: number,
  pairs: { pending: PendingVector; vector: number[] }[],
): Promise<void> {
  await withTenant(deps.db, { organizationId }, async (tx) => {
    for (const { pending, vector } of pairs) {
      const literal = `[${vector.join(",")}]`;
      await tx.execute(sql`
        INSERT INTO embedding
          (organization_id, object_ref_id, source_table, source_id, chunk_index, chunk_text,
           model_name, dimensions, vector)
        VALUES (${organizationId}::uuid, ${pending.objectRefId}::uuid, ${pending.sourceTable},
                ${pending.sourceId}::uuid, 0, ${pending.chunkText},
                ${modelName}, ${dimensions}, ${literal}::vector)
        ON CONFLICT (organization_id, source_table, source_id, chunk_index, model_name) DO UPDATE SET
          object_ref_id = EXCLUDED.object_ref_id,
          chunk_text = EXCLUDED.chunk_text,
          dimensions = EXCLUDED.dimensions,
          vector = EXCLUDED.vector,
          updated_at = now(),
          version = embedding.version + 1`);
    }
  });
}

export type VectorPassResult = { embedded: number; skipped: string | null };

export async function indexVectors(deps: Deps, organizationId: string): Promise<VectorPassResult> {
  const ai = deps.ai;
  if (!ai) return { embedded: 0, skipped: "ai_unconfigured" };
  const modelName = ai.embedModelId;
  if (!modelName) return { embedded: 0, skipped: "provider_has_no_embeddings" };

  let embedded = 0;
  for (let batch = 0; batch < EMBED_BATCHES_PER_RUN; batch += 1) {
    const pending = await pendingVectors(deps, organizationId, modelName, EMBED_BATCH_SIZE);
    if (pending.length === 0) return { embedded, skipped: null };

    const result = await ai.embed({
      texts: pending.map((entry) => entry.chunkText),
      requestId: currentRequestId(),
    });
    if (!result.ok) {
      log.warn(
        { organizationId, reason: result.reason, detail: result.detail },
        "vector half deferred to a later pass",
      );
      return { embedded, skipped: result.reason };
    }

    const pairs = pending.map((entry, index) => ({
      pending: entry,
      vector: result.vectors[index] as number[],
    }));
    await writeVectors(deps, organizationId, result.modelId, result.dimensions, pairs);
    embedded += pairs.length;
  }
  return { embedded, skipped: "batch_budget_reached" };
}

async function readCursor(deps: Deps, organizationId: string, stream: string): Promise<string> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const found = await tx
      .select({ cursorValue: tables.integrationCursor.cursorValue })
      .from(tables.integrationCursor)
      .where(
        and(
          eq(tables.integrationCursor.connector, CONNECTOR),
          eq(tables.integrationCursor.stream, stream),
        ),
      )
      .limit(1);
    return found[0]?.cursorValue ?? EPOCH;
  });
}

async function saveCursor(
  deps: Deps,
  organizationId: string,
  stream: string,
  patch: { cursorValue?: string; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const success = patch.error === undefined;
  await withTenant(deps.db, { organizationId }, async (tx) => {
    await tx
      .insert(tables.integrationCursor)
      .values({
        organizationId,
        connector: CONNECTOR,
        stream,
        cursorKind: "timestamp",
        overlapSeconds: OVERLAP_SECONDS,
        cursorValue: patch.cursorValue ?? null,
        lastAttemptAt: now,
        lastSuccessAt: success ? now : null,
        lastError: patch.error ?? null,
        consecutiveFailures: success ? 0 : 1,
        health: success ? "healthy" : "degraded",
      })
      .onConflictDoUpdate({
        target: [
          tables.integrationCursor.organizationId,
          tables.integrationCursor.connector,
          tables.integrationCursor.stream,
        ],
        set: {
          lastAttemptAt: now,
          ...(patch.cursorValue === undefined ? {} : { cursorValue: patch.cursorValue }),
          ...(success
            ? { lastSuccessAt: now, lastError: null, consecutiveFailures: 0, health: "healthy" }
            : { lastError: patch.error, health: "degraded" }),
          updatedAt: now,
        },
      });
  });
}

/** The cursor is re-read with an overlap; every write is an upsert, so a replay is free. */
export function withOverlap(cursorValue: string): string {
  const parsed = Date.parse(cursorValue);
  if (Number.isNaN(parsed)) return EPOCH;
  return new Date(parsed - OVERLAP_SECONDS * 1000).toISOString();
}

export type OrganizationIndexResult = {
  organizationId: string;
  indexed: number;
  unlinked: number;
  failedSources: string[];
  vectors: VectorPassResult;
};

export async function indexOrganization(
  deps: Deps,
  organizationId: string,
): Promise<OrganizationIndexResult> {
  let indexed = 0;
  let unlinked = 0;
  const failedSources: string[] = [];

  for (const table of SOURCE_TABLES) {
    try {
      const cursor = await readCursor(deps, organizationId, table);
      const pass = await indexTextForSource(deps, organizationId, table, withOverlap(cursor));
      indexed += pass.indexed;
      unlinked += pass.unlinked;
      await saveCursor(deps, organizationId, table, {
        ...(pass.lastChangedAt === null ? {} : { cursorValue: pass.lastChangedAt }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error({ organizationId, table, err: error }, "text indexing failed, cursor untouched");
      failedSources.push(table);
      await saveCursor(deps, organizationId, table, { error: detail.slice(0, 500) });
    }
  }

  // The vector half runs only once the text half is written: a missing embedding
  // is a later pass, never a half-written search_document row.
  const vectors =
    failedSources.length === SOURCE_TABLES.length
      ? { embedded: 0, skipped: "text_pass_failed" }
      : await indexVectors(deps, organizationId);

  return { organizationId, indexed, unlinked, failedSources, vectors };
}

export async function runSearchIndex(deps: Deps): Promise<JobOutcome> {
  const organizationIds = await forEachOrganizationId(deps);
  const results: OrganizationIndexResult[] = [];
  for (const organizationId of organizationIds) {
    results.push(await indexOrganization(deps, organizationId));
  }

  const attempted = organizationIds.length * SOURCE_TABLES.length;
  const failed = results.reduce((total, result) => total + result.failedSources.length, 0);
  if (attempted > 0 && failed === attempted) {
    // "Nothing found" and "I could not look" must not render the same.
    throw new Error(`search indexing failed on every source of every organization (${attempted})`);
  }

  return {
    outcome: "indexed",
    organizations: organizationIds.length,
    indexed: results.reduce((total, result) => total + result.indexed, 0),
    unlinked: results.reduce((total, result) => total + result.unlinked, 0),
    embedded: results.reduce((total, result) => total + result.vectors.embedded, 0),
    failedSources: failed,
    vectorsSkipped: [...new Set(results.map((r) => r.vectors.skipped).filter(Boolean))],
  };
}

export const searchIndex = defineJob({
  name: "search.index",
  schema: SearchIndexData,
  options: {
    retryLimit: 2,
    retryDelay: 300,
    retryBackoff: true,
    expireInSeconds: 1800,
    localConcurrency: 1,
  },
  schedule: { cron: "*/10 * * * *", tz: "Europe/Paris" },
  handler: (_data, deps) => runSearchIndex(deps),
});
