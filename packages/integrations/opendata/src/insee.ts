import { AppError } from "@lfsci/kernel";
import { z } from "zod";
import type { OpenDataConfig } from "./config";
import { INSEE_IRL_SERIES_ID } from "./config";
import type { FetchLike } from "./http";
import { getWithRetry, type Sleep } from "./request";

const SERVICE = "insee-bdm";

export const IrlObservation = z.object({
  seriesId: z.string(),
  period: z.string().regex(/^\d{4}-Q[1-4]$/),
  year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  value: z.number(),
});
export type IrlObservation = z.infer<typeof IrlObservation>;

const obsPattern = /<(?:\w+:)?Obs\b([^>]*?)\/?>/g;

function attribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attributes);
  return match?.[1];
}

export function parseSdmxObservations(xml: string): { period: string; value: number }[] {
  const out: { period: string; value: number }[] = [];
  for (const match of xml.matchAll(obsPattern)) {
    const attributes = match[1] ?? "";
    const period = attribute(attributes, "TIME_PERIOD");
    const value = attribute(attributes, "OBS_VALUE");
    if (!period || value === undefined) continue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    out.push({ period, value: parsed });
  }
  return out;
}

export type InseeClient = {
  fetchIrl(quarter: number, year: number): Promise<IrlObservation>;
  fetchIrlSeries(): Promise<IrlObservation[]>;
};

export function createInseeClient(input: {
  config: OpenDataConfig;
  fetch?: FetchLike;
  sleep?: Sleep;
  seriesId?: string;
}): InseeClient {
  const { config } = input;
  const doFetch = input.fetch ?? globalThis.fetch;
  const seriesId = input.seriesId ?? INSEE_IRL_SERIES_ID;

  async function series(): Promise<IrlObservation[]> {
    const headers: Record<string, string> = { accept: "application/xml" };
    if (config.inseeApiKey) headers.authorization = `Bearer ${config.inseeApiKey}`;
    const response = await getWithRetry({
      url: `${config.inseeBaseUrl}/data/SERIES_BDM/${seriesId}`,
      headers,
      service: SERVICE,
      config,
      fetch: doFetch,
      ...(input.sleep ? { sleep: input.sleep } : {}),
    });
    return parseSdmxObservations(await response.text()).map((observation) => {
      const [year, quarter] = observation.period.split("-Q");
      return IrlObservation.parse({
        seriesId,
        period: observation.period,
        year: Number(year),
        quarter: Number(quarter),
        value: observation.value,
      });
    });
  }

  return {
    fetchIrlSeries: series,

    async fetchIrl(quarter, year) {
      if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
        throw new AppError("VALIDATION", { message: "quarter must be 1, 2, 3 or 4" });
      }
      const period = `${year}-Q${quarter}`;
      const found = (await series()).find((observation) => observation.period === period);
      if (!found) {
        throw new AppError("NOT_FOUND", {
          message: "IRL not published for this quarter",
          details: { seriesId, period },
        });
      }
      return found;
    },
  };
}
