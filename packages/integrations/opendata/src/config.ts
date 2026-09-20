import { parseEnv } from "@lfsci/kernel";
import { z } from "zod";

// INSEE BDM series 001515333 = Indice de référence des loyers, France métropolitaine (tech-pack I13).
export const INSEE_IRL_SERIES_ID = "001515333";
export const INSEE_BDM_BASE_URL = "https://api.insee.fr/series/BDM/V1";
// Bearer vs api key header on portail-api.insee.fr: TO CONFIRM once a portal account exists.
export const INSEE_AUTH_SCHEME = "bearer" as const;

export const ADEME_DPE_BASE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets";
export const ADEME_DPE_DATASET = "dpe03existant";

// IGN Géoplateforme geocoding: 50 requests per second per IP, 429 carries retry-after.
// The /geocodage/search path is TO CONFIRM against the current Géoplateforme catalogue.
export const IGN_GEOCODE_URL = "https://data.geopf.fr/geocodage/search";
export const IGN_GEOCODE_RATE_PER_SECOND = 50;
export const APICARTO_PARCELLE_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";

export const OpenDataConfig = z.object({
  inseeBaseUrl: z.url().default(INSEE_BDM_BASE_URL),
  inseeApiKey: z.string().min(1).optional(),
  ademeBaseUrl: z.url().default(ADEME_DPE_BASE_URL),
  ignGeocodeUrl: z.url().default(IGN_GEOCODE_URL),
  apicartoParcelleUrl: z.url().default(APICARTO_PARCELLE_URL),
  timeoutMs: z.number().int().positive().default(15_000),
  maxRetries: z.number().int().min(0).max(5).default(2),
});
export type OpenDataConfig = z.infer<typeof OpenDataConfig>;

export function openDataConfigFromEnv(source: NodeJS.ProcessEnv = process.env): OpenDataConfig {
  const env = parseEnv(
    {
      INSEE_BASE_URL: z.url().default(INSEE_BDM_BASE_URL),
      INSEE_API_KEY: z.string().trim().min(1).optional(),
      ADEME_BASE_URL: z.url().default(ADEME_DPE_BASE_URL),
      IGN_GEOCODE_URL: z.url().default(IGN_GEOCODE_URL),
      APICARTO_PARCELLE_URL: z.url().default(APICARTO_PARCELLE_URL),
      OPENDATA_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
      OPENDATA_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    },
    source,
  );
  return OpenDataConfig.parse({
    inseeBaseUrl: env.INSEE_BASE_URL,
    ...(env.INSEE_API_KEY ? { inseeApiKey: env.INSEE_API_KEY } : {}),
    ademeBaseUrl: env.ADEME_BASE_URL,
    ignGeocodeUrl: env.IGN_GEOCODE_URL,
    apicartoParcelleUrl: env.APICARTO_PARCELLE_URL,
    timeoutMs: env.OPENDATA_TIMEOUT_MS,
    maxRetries: env.OPENDATA_MAX_RETRIES,
  });
}
