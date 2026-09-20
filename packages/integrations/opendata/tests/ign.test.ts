import { describe, expect, it } from "vitest";
import { OpenDataConfig } from "../src/config";
import type { FetchLike } from "../src/http";
import { createIgnClient } from "../src/ign";
import { retryAfterMs } from "../src/request";

const config = OpenDataConfig.parse({});

const geocodeBody = {
  type: "FeatureCollection",
  features: [
    {
      geometry: { type: "Point", coordinates: [-0.375, 43.315] },
      properties: {
        label: "2 Rue Henri Farman 64230 Lescar",
        score: 0.97,
        postcode: "64230",
        city: "Lescar",
        citycode: "64335",
      },
    },
  ],
};

describe("IGN geocoding", () => {
  it("builds the Géoplateforme query and maps the GeoJSON features", async () => {
    const calls: string[] = [];
    const client = createIgnClient({
      config,
      fetch: (async (input) => {
        calls.push(String(input));
        return Response.json(geocodeBody);
      }) as FetchLike,
    });

    await expect(
      client.geocode({ q: "2 rue Henri Farman Lescar", limit: 3, index: "address" }),
    ).resolves.toEqual([
      {
        label: "2 Rue Henri Farman 64230 Lescar",
        score: 0.97,
        postcode: "64230",
        city: "Lescar",
        inseeCode: "64335",
        longitude: -0.375,
        latitude: 43.315,
      },
    ]);
    const url = new URL(calls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://data.geopf.fr/geocodage/search");
    expect(url.searchParams.get("limit")).toBe("3");
    expect(url.searchParams.get("index")).toBe("address");
  });

  it("honours retry-after on 429 then succeeds", async () => {
    const waits: number[] = [];
    let attempt = 0;
    const client = createIgnClient({
      config,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      fetch: (async () => {
        attempt += 1;
        return attempt === 1
          ? new Response("slow down", { status: 429, headers: { "retry-after": "2" } })
          : Response.json(geocodeBody);
      }) as FetchLike,
    });

    await expect(client.geocode({ q: "Lescar" })).resolves.toHaveLength(1);
    expect(waits).toEqual([2000]);
    expect(attempt).toBe(2);
  });

  it("gives up with QUOTA_EXCEEDED once the retries are spent", async () => {
    let attempt = 0;
    const client = createIgnClient({
      config: OpenDataConfig.parse({ maxRetries: 1 }),
      sleep: () => Promise.resolve(),
      fetch: (async () => {
        attempt += 1;
        return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
      }) as FetchLike,
    });
    await expect(client.geocode({ q: "Lescar" })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(attempt).toBe(2);
  });

  it("reads retry-after as seconds and as an HTTP date", () => {
    expect(retryAfterMs(new Response(null, { headers: { "retry-after": "3" } }))).toBe(3000);
    expect(retryAfterMs(new Response(null))).toBeUndefined();
    const future = new Date(Date.now() + 5000).toUTCString();
    expect(
      retryAfterMs(new Response(null, { headers: { "retry-after": future } })),
    ).toBeGreaterThan(0);
  });

  it("queries the cadastre by insee code, section and numero", async () => {
    const calls: string[] = [];
    const client = createIgnClient({
      config,
      fetch: (async (input) => {
        calls.push(String(input));
        return Response.json({
          features: [{ properties: { idu: "64335000AB0042", contenance: 512 } }],
        });
      }) as FetchLike,
    });
    await expect(
      client.fetchParcelle({ codeInsee: "64335", section: "AB", numero: "0042" }),
    ).resolves.toEqual([{ properties: { idu: "64335000AB0042", contenance: 512 } }]);
    const url = new URL(calls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://apicarto.ign.fr/api/cadastre/parcelle");
    expect(url.searchParams.get("code_insee")).toBe("64335");
  });
});
