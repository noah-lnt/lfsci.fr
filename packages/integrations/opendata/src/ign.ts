import { AppError } from "@lfsci/kernel";
import { z } from "zod";
import type { OpenDataConfig } from "./config";
import { type FetchLike, parseUpstream } from "./http";
import { getWithRetry, type Sleep } from "./request";

const GEOCODE_SERVICE = "ign-geocodage";
const CADASTRE_SERVICE = "apicarto-cadastre";

const Position = z.tuple([z.number(), z.number()]);

const GeocodeFeature = z.object({
  geometry: z.object({ type: z.literal("Point"), coordinates: Position }),
  properties: z
    .object({
      label: z.string(),
      score: z.number().optional(),
      postcode: z.string().optional(),
      city: z.string().optional(),
      citycode: z.string().optional(),
      housenumber: z.string().optional(),
      street: z.string().optional(),
      type: z.string().optional(),
    })
    .loose(),
});

const GeocodeResponse = z.object({ features: z.array(GeocodeFeature) });

export type GeocodedAddress = {
  label: string;
  score: number | undefined;
  postcode: string | undefined;
  city: string | undefined;
  inseeCode: string | undefined;
  longitude: number;
  latitude: number;
};

export const ParcelleFeature = z.object({
  properties: z
    .object({
      idu: z.string().optional(),
      code_insee: z.string().optional(),
      section: z.string().optional(),
      numero: z.string().optional(),
      contenance: z.number().optional(),
      commune: z.string().optional(),
    })
    .loose(),
});
export type ParcelleFeature = z.infer<typeof ParcelleFeature>;

const ParcelleResponse = z.object({ features: z.array(ParcelleFeature) });

export type IgnClient = {
  geocode(query: { q: string; limit?: number; index?: string }): Promise<GeocodedAddress[]>;
  fetchParcelle(query: {
    codeInsee: string;
    section: string;
    numero: string;
  }): Promise<ParcelleFeature[]>;
};

export function createIgnClient(input: {
  config: OpenDataConfig;
  fetch?: FetchLike;
  sleep?: Sleep;
}): IgnClient {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;
  const sleepOption = input.sleep ? { sleep: input.sleep } : {};

  return {
    async geocode({ q, limit, index }) {
      if (q.trim().length === 0) throw new AppError("VALIDATION", { message: "empty query" });
      const url = new URL(config.ignGeocodeUrl);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit ?? 5));
      if (index) url.searchParams.set("index", index);

      const response = await getWithRetry({
        url: url.toString(),
        headers: { accept: "application/json" },
        service: GEOCODE_SERVICE,
        config,
        fetch: doFetch,
        ...sleepOption,
      });
      const parsed = parseUpstream(GeocodeResponse, await response.json(), GEOCODE_SERVICE);
      return parsed.features.map((feature) => ({
        label: feature.properties.label,
        score: feature.properties.score,
        postcode: feature.properties.postcode,
        city: feature.properties.city,
        inseeCode: feature.properties.citycode,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      }));
    },

    async fetchParcelle({ codeInsee, section, numero }) {
      const url = new URL(config.apicartoParcelleUrl);
      url.searchParams.set("code_insee", codeInsee);
      url.searchParams.set("section", section);
      url.searchParams.set("numero", numero);

      const response = await getWithRetry({
        url: url.toString(),
        headers: { accept: "application/json" },
        service: CADASTRE_SERVICE,
        config,
        fetch: doFetch,
        ...sleepOption,
      });
      return parseUpstream(ParcelleResponse, await response.json(), CADASTRE_SERVICE).features;
    },
  };
}
