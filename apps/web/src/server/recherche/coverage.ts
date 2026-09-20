import "server-only";
import { sql } from "drizzle-orm";
import type { SearchCoverage, SearchSourceKind, SourceCoverage } from "@/lib/contracts/recherche";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { instant } from "../finance/shared";

/** The connector the indexing job writes its cursors under (`searchIndex.ts`). */
const CONNECTOR = "search";

const KINDS: SearchSourceKind[] = ["document", "activity", "event", "intervention"];

type RawCoverage = {
  kind: string;
  total: string;
  indexed: string;
  embedded: string;
  last_indexed_at: string | null;
  health: string | null;
  last_success_at: string | null;
  last_error: string | null;
};

/**
 * MEM-02: a corpus half indexed answers half a question. The totals come from the
 * source tables, the indexed counts from `search_document`, and the cursor's own
 * health separates "nothing matched" from "this source was never swept".
 */
const QUERY = sql`
  WITH totals AS (
    SELECT 'document' AS kind, count(*)::text AS total FROM document WHERE purged_at IS NULL
     UNION ALL SELECT 'activity', count(*)::text FROM activity
     UNION ALL SELECT 'event', count(*)::text FROM event
     UNION ALL SELECT 'intervention', count(*)::text FROM intervention
  ),
  indexed AS (
    SELECT s.source_table AS kind, count(*)::text AS indexed,
           count(e.id)::text AS embedded,
           to_char(max(s.indexed_at), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS last_indexed_at
      FROM search_document s
      LEFT JOIN embedding e ON e.source_table = s.source_table AND e.source_id = s.source_id
       AND e.chunk_index = 0 AND e.excluded_from_ai_memory = FALSE
     GROUP BY s.source_table
  )
  SELECT t.kind, t.total,
         COALESCE(i.indexed, '0') AS indexed,
         COALESCE(i.embedded, '0') AS embedded,
         i.last_indexed_at,
         c.health,
         to_char(c.last_success_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS last_success_at,
         c.last_error
    FROM totals t
    LEFT JOIN indexed i ON i.kind = t.kind
    LEFT JOIN integration_cursor c ON c.connector = ${CONNECTOR} AND c.stream = t.kind`;

function toSource(raw: RawCoverage): SourceCoverage {
  return {
    kind: raw.kind as SearchSourceKind,
    total: Number(raw.total),
    indexed: Number(raw.indexed),
    embedded: Number(raw.embedded),
    lastIndexedAt: instant(raw.last_indexed_at),
    health: (raw.health as SourceCoverage["health"]) ?? null,
    lastSuccessAt: instant(raw.last_success_at),
    lastError: raw.last_error,
  };
}

function empty(kind: SearchSourceKind): SourceCoverage {
  return {
    kind,
    total: 0,
    indexed: 0,
    embedded: 0,
    lastIndexedAt: null,
    health: null,
    lastSuccessAt: null,
    lastError: null,
  };
}

export async function readCoverage(scope: TenantScope): Promise<SearchCoverage> {
  const raws = await tenant(scope, async (tx) => [...(await tx.execute<RawCoverage>(QUERY))]);
  const byKind = new Map(raws.map((raw) => [raw.kind, toSource(raw as RawCoverage)]));
  const sources = KINDS.map((kind) => byKind.get(kind) ?? empty(kind));

  const sum = (pick: (source: SourceCoverage) => number) =>
    sources.reduce((total, source) => total + pick(source), 0);
  const stamps = sources
    .map((source) => source.lastIndexedAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    sources,
    total: sum((source) => source.total),
    indexed: sum((source) => source.indexed),
    embedded: sum((source) => source.embedded),
    lastIndexedAt: stamps[stamps.length - 1] ?? null,
    complete: sources.every((source) => source.indexed >= source.total),
    degraded: sources.some((source) => source.health !== null && source.health !== "healthy"),
  };
}
