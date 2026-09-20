import { IsoDateTime, ObjectRef, Uuid } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** MEM-01: documents, activities, events and interventions, the four indexed sources. */
export const SearchSourceKind = z.enum(["document", "activity", "event", "intervention"]);
export type SearchSourceKind = z.infer<typeof SearchSourceKind>;

export const SearchMatchKind = z.enum(["words", "meaning", "both"]);
export type SearchMatchKind = z.infer<typeof SearchMatchKind>;

export const SearchHit = z.object({
  id: Uuid,
  sourceKind: SearchSourceKind,
  sourceId: Uuid,
  title: z.string().nullable(),
  /** The matching passage; `[[` and `]]` bracket the matched words. */
  excerpt: z.string().nullable(),
  /** The source object's own date, not the date it was indexed. */
  occurredAt: IsoDateTime.nullable(),
  indexedAt: IsoDateTime,
  object: ObjectRef.nullable(),
  href: z.string().nullable(),
  matchedOn: SearchMatchKind,
  score: z.number(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SearchSemantic = z.object({
  used: z.boolean(),
  /** Why the vector half was skipped; the text half answered alone. */
  reason: z.string().nullable(),
});
export type SearchSemantic = z.infer<typeof SearchSemantic>;

export const SearchResult = z.object({
  query: z.string(),
  items: z.array(SearchHit),
  /** True when the ranked window was full: there may be more beyond it. */
  truncated: z.boolean(),
  semantic: SearchSemantic,
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SourceCoverage = z.object({
  kind: SearchSourceKind,
  total: z.number().int(),
  indexed: z.number().int(),
  embedded: z.number().int(),
  lastIndexedAt: IsoDateTime.nullable(),
  /** The indexing cursor's own health; null when the source has never been swept. */
  health: z.enum(["healthy", "degraded", "stalled", "unavailable"]).nullable(),
  lastSuccessAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
});
export type SourceCoverage = z.infer<typeof SourceCoverage>;

/** MEM-02: a search that misses half the corpus says so rather than answering "rien". */
export const SearchCoverage = z.object({
  sources: z.array(SourceCoverage),
  total: z.number().int(),
  indexed: z.number().int(),
  embedded: z.number().int(),
  lastIndexedAt: IsoDateTime.nullable(),
  complete: z.boolean(),
  degraded: z.boolean(),
});
export type SearchCoverage = z.infer<typeof SearchCoverage>;

export const SearchInput = z.object({
  query: z.string().min(2).max(200),
  kinds: z.array(SearchSourceKind).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchInput = z.infer<typeof SearchInput>;

export const rechercheContract = {
  recherche: {
    search: oc
      .route({ method: "GET", path: "/recherche", summary: "Recherche dans le corpus indexé" })
      .input(SearchInput)
      .output(SearchResult),
    coverage: oc
      .route({ method: "GET", path: "/recherche/couverture", summary: "Couverture de l’index" })
      .output(SearchCoverage),
  },
};
