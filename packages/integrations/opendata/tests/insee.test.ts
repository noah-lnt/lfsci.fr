import { describe, expect, it } from "vitest";
import { OpenDataConfig } from "../src/config";
import type { FetchLike } from "../src/http";
import { createInseeClient, parseSdmxObservations } from "../src/insee";

const config = OpenDataConfig.parse({});

const sdmx = `<?xml version="1.0" encoding="UTF-8"?>
<message:StructureSpecificData xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message">
  <message:DataSet>
    <Series IDBANK="001515333" TITLE_FR="Indice de référence des loyers">
      <Obs TIME_PERIOD="2026-Q1" OBS_VALUE="147.45" OBS_STATUS="A"/>
      <Obs TIME_PERIOD="2026-Q2" OBS_VALUE="148.37" OBS_STATUS="A"/>
      <Obs OBS_VALUE="0" OBS_STATUS="A"/>
    </Series>
  </message:DataSet>
</message:StructureSpecificData>`;

describe("INSEE IRL", () => {
  it("parses the SDMX-ML observations and skips a period-less one", () => {
    expect(parseSdmxObservations(sdmx)).toEqual([
      { period: "2026-Q1", value: 147.45 },
      { period: "2026-Q2", value: 148.37 },
    ]);
  });

  it("fetches one quarter from series 001515333 with the xml accept header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createInseeClient({
      config: OpenDataConfig.parse({ inseeApiKey: "insee-key" }),
      fetch: (async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(sdmx, { headers: { "content-type": "application/xml" } });
      }) as FetchLike,
    });

    await expect(client.fetchIrl(2, 2026)).resolves.toEqual({
      seriesId: "001515333",
      period: "2026-Q2",
      year: 2026,
      quarter: 2,
      value: 148.37,
    });
    expect(calls[0]?.url).toBe("https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001515333");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.accept).toBe("application/xml");
    expect(headers.authorization).toBe("Bearer insee-key");
  });

  it("reports an unpublished quarter as NOT_FOUND and a bad quarter as VALIDATION", async () => {
    const client = createInseeClient({
      config,
      fetch: (async () => new Response(sdmx)) as FetchLike,
    });
    await expect(client.fetchIrl(4, 2026)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client.fetchIrl(5, 2026)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
