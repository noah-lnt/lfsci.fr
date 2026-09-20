import "server-only";
import type { ObjectRef } from "@lfsci/contracts";
import type { Tx } from "@lfsci/db";
import { type RankedSearchHit, rankSearchHits } from "@lfsci/domain";
import { sql } from "drizzle-orm";
import type { SearchHit, SearchInput, SearchResult } from "@/lib/contracts/recherche";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { instant } from "../finance/shared";
import { embedQuery, type QueryVector } from "./embed";
import { objectHref } from "./links";

/** `search_document.tsv` is built by the worker with this configuration (searchIndex.ts). */
const LANGUAGE = sql.raw("'french'::regconfig");

/**
 * The window each half contributes before the two are merged and re-ranked. Wider
 * than the answer so a row the other half also found is not lost at the boundary.
 */
const CANDIDATE_FACTOR = 5;

/** `ts_headline` brackets the matched words; the component turns these into `<mark>`. */
const HEADLINE_OPTIONS =
  "StartSel=[[,StopSel=]],MaxFragments=2,FragmentDelimiter= … ,MaxWords=30,MinWords=12,ShortWord=2";

type RawHit = {
  id: string;
  source_table: string;
  source_id: string;
  title: string | null;
  excerpt: string | null;
  occurred_at: string | null;
  indexed_at: string;
  object_kind: string | null;
  object_id: string | null;
  text_rank: number | string | null;
  distance: number | string | null;
};

const OBJECT_ID = sql`COALESCE(o.legal_entity_id, o.building_id, o.unit_id, o.person_id, o.lease_id,
  o.rent_term_id, o.payment_id, o.deposit_account_id, o.expense_id, o.works_project_id,
  o.intervention_id, o.equipment_id, o.meter_id, o.loan_id, o.partner_current_account_id,
  o.fixed_asset_id, o.insurance_policy_id, o.claim_id, o.booking_id, o.listing_id,
  o.inspection_id, o.supplier_id, o.bank_account_id, o.document_id)`;

/**
 * MEM-01: the rights are the tenant transaction, applied before retrieval — and the
 * source row is joined back here so a document purged since it was indexed drops out
 * of the answer instead of being served from the index.
 */
const SOURCE_JOINS = sql`
  LEFT JOIN document d ON s.source_table = 'document' AND d.id = s.source_id AND d.purged_at IS NULL
  LEFT JOIN activity a ON s.source_table = 'activity' AND a.id = s.source_id
  LEFT JOIN event ev ON s.source_table = 'event' AND ev.id = s.source_id
  LEFT JOIN intervention iv ON s.source_table = 'intervention' AND iv.id = s.source_id`;

const OCCURRED_AT = sql`CASE s.source_table
    WHEN 'document' THEN COALESCE(d.period_start::timestamptz, d.created_at)
    WHEN 'activity' THEN a.occurred_at
    WHEN 'event' THEN ev.occurred_at
    WHEN 'intervention' THEN COALESCE(iv.completed_on::timestamptz, iv.scheduled_on::timestamptz,
                                      iv.reported_on::timestamptz, iv.created_at)
  END`;

const SOURCE_EXISTS = sql`(d.id IS NOT NULL OR a.id IS NOT NULL OR ev.id IS NOT NULL OR iv.id IS NOT NULL)`;

function filters(input: SearchInput): ReturnType<typeof sql> {
  const clauses = [SOURCE_EXISTS];
  if (input.kinds && input.kinds.length > 0) {
    const list = sql.join(
      input.kinds.map((kind) => sql`${kind}`),
      sql`, `,
    );
    clauses.push(sql`s.source_table IN (${list})`);
  }
  if (input.from) clauses.push(sql`${OCCURRED_AT} >= ${input.from}::timestamptz`);
  if (input.to) clauses.push(sql`${OCCURRED_AT} < (${input.to}::date + 1)::timestamptz`);
  return sql.join(clauses, sql` AND `);
}

/** The nearest neighbours, for candidate discovery only. */
function semanticCte(vector: QueryVector | null, candidates: number): ReturnType<typeof sql> {
  if (!vector) return sql`SELECT NULL::uuid AS id WHERE FALSE`;
  return sql`
    SELECT s.id
      FROM search_document s
      JOIN embedding e ON e.source_table = s.source_table AND e.source_id = s.source_id
       AND e.model_name = ${vector.modelName} AND e.excluded_from_ai_memory = FALSE
     GROUP BY s.id
     ORDER BY MIN(e.vector <=> ${vector.literal}::vector)
     LIMIT ${candidates}`;
}

/**
 * The distance is recomputed for every candidate, including those the vector window
 * missed: a row that has an embedding must not be scored as if it had none just
 * because the lexical half is what surfaced it.
 */
function distanceJoin(vector: QueryVector | null): ReturnType<typeof sql> {
  if (!vector) return sql`LEFT JOIN LATERAL (SELECT NULL::float8 AS distance) dist ON TRUE`;
  return sql`
    LEFT JOIN LATERAL (
      SELECT MIN(e.vector <=> ${vector.literal}::vector)::float8 AS distance
        FROM embedding e
       WHERE e.source_table = s.source_table AND e.source_id = s.source_id
         AND e.model_name = ${vector.modelName} AND e.excluded_from_ai_memory = FALSE
    ) dist ON TRUE`;
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchHits(
  tx: Tx,
  input: SearchInput,
  vector: QueryVector | null,
): Promise<RawHit[]> {
  const candidates = input.limit * CANDIDATE_FACTOR;
  const where = filters(input);

  // The two halves are windowed on their own index (GIN, then HNSW) and the filters
  // are applied to the merged candidates: a narrow period can therefore empty an
  // answer whose window was full, which `truncated` reports rather than hides.
  const rows = await tx.execute<RawHit>(sql`
    WITH q AS (SELECT websearch_to_tsquery(${LANGUAGE}, unaccent(${input.query})) AS tsq),
    lexical AS (
      SELECT s.id, ts_rank_cd(s.tsv, q.tsq)::float8 AS text_rank
        FROM search_document s, q
       WHERE s.tsv @@ q.tsq
       ORDER BY text_rank DESC
       LIMIT ${candidates}
    ),
    semantic AS (${semanticCte(vector, candidates)}),
    candidate AS (SELECT id FROM lexical UNION SELECT id FROM semantic WHERE id IS NOT NULL)
    SELECT s.id, s.source_table, s.source_id, s.title,
           ts_headline(${LANGUAGE}, COALESCE(s.body, s.title, ''),
                       websearch_to_tsquery(${LANGUAGE}, ${input.query}),
                       ${HEADLINE_OPTIONS}) AS excerpt,
           to_char(${OCCURRED_AT}, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS occurred_at,
           to_char(s.indexed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS indexed_at,
           o.kind AS object_kind, ${OBJECT_ID} AS object_id,
           COALESCE(lexical.text_rank, 0) AS text_rank, dist.distance
      FROM candidate c
      JOIN search_document s ON s.id = c.id
      LEFT JOIN lexical ON lexical.id = s.id
      LEFT JOIN object_ref o ON o.id = s.object_ref_id
      ${SOURCE_JOINS}
      ${distanceJoin(vector)}
     WHERE ${where}`);

  return [...rows] as RawHit[];
}

function toHit(raw: RawHit, ranked: RankedSearchHit): SearchHit {
  const object: ObjectRef | null =
    raw.object_kind && raw.object_id
      ? ({ kind: raw.object_kind, id: raw.object_id } as ObjectRef)
      : null;
  return {
    id: raw.id,
    sourceKind: raw.source_table as SearchHit["sourceKind"],
    sourceId: raw.source_id,
    title: raw.title,
    excerpt: raw.excerpt,
    occurredAt: instant(raw.occurred_at),
    indexedAt: instant(raw.indexed_at) ?? new Date().toISOString(),
    object,
    href: objectHref(raw.object_kind, raw.object_id),
    matchedOn: ranked.matchedOn,
    score: ranked.score,
  };
}

export async function search(scope: TenantScope, input: SearchInput): Promise<SearchResult> {
  const embedded = await embedQuery(input.query, scope.requestId);
  const vector = embedded.ok ? embedded.vector : null;

  const raws = await tenant(scope, (tx) => fetchHits(tx, input, vector));
  const byId = new Map(raws.map((raw) => [raw.id, raw]));
  const ranked = rankSearchHits(
    raws.map((raw) => ({
      id: raw.id,
      textRank: numberOrNull(raw.text_rank) ?? 0,
      vectorDistance: numberOrNull(raw.distance),
    })),
  );

  const items = ranked.slice(0, input.limit).flatMap((hit) => {
    const raw = byId.get(hit.id);
    return raw ? [toHit(raw, hit)] : [];
  });

  return {
    query: input.query,
    items,
    truncated: ranked.length > items.length,
    semantic: { used: vector !== null, reason: embedded.ok ? null : embedded.reason },
  };
}
