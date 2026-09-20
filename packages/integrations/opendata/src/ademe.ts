import { z } from "zod";
import type { OpenDataConfig } from "./config";
import { ADEME_DPE_DATASET } from "./config";
import { type FetchLike, parseUpstream } from "./http";
import { getWithRetry, type Sleep } from "./request";

const SERVICE = "ademe-dpe";

export const DpeLine = z
  .object({
    _id: z.string().optional(),
    numero_dpe: z.string().optional(),
    etiquette_dpe: z.string().optional(),
    etiquette_ges: z.string().optional(),
    date_etablissement_dpe: z.string().optional(),
    adresse_ban: z.string().optional(),
    code_postal_ban: z.string().optional(),
    surface_habitable_logement: z.number().optional(),
  })
  .loose();
export type DpeLine = z.infer<typeof DpeLine>;

export const DpeSearchResult = z.object({ total: z.number().int(), results: z.array(DpeLine) });
export type DpeSearchResult = z.infer<typeof DpeSearchResult>;

export type AdemeClient = {
  searchDpe(query: {
    q?: string;
    qs?: string;
    size?: number;
    select?: string[];
  }): Promise<DpeSearchResult>;
};

export function createAdemeClient(input: {
  config: OpenDataConfig;
  fetch?: FetchLike;
  sleep?: Sleep;
}): AdemeClient {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;

  return {
    async searchDpe(query) {
      const url = new URL(`${config.ademeBaseUrl}/${ADEME_DPE_DATASET}/lines`);
      if (query.q) url.searchParams.set("q", query.q);
      if (query.qs) url.searchParams.set("qs", query.qs);
      url.searchParams.set("size", String(query.size ?? 20));
      if (query.select?.length) url.searchParams.set("select", query.select.join(","));

      const response = await getWithRetry({
        url: url.toString(),
        headers: { accept: "application/json" },
        service: SERVICE,
        config,
        fetch: doFetch,
        ...(input.sleep ? { sleep: input.sleep } : {}),
      });
      return parseUpstream(DpeSearchResult, await response.json(), SERVICE);
    },
  };
}
