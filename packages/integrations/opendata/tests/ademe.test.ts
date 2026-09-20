import { describe, expect, it } from "vitest";
import { createAdemeClient } from "../src/ademe";
import { OpenDataConfig } from "../src/config";
import type { FetchLike } from "../src/http";

const config = OpenDataConfig.parse({});

describe("ADEME DPE", () => {
  it("queries dpe03existant with q, qs and size and needs no key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createAdemeClient({
      config,
      fetch: (async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Response.json({
          total: 1,
          results: [{ numero_dpe: "2364E0123456X", etiquette_dpe: "D", etiquette_ges: "C" }],
        });
      }) as FetchLike,
    });

    const result = await client.searchDpe({ q: "64230 Lescar", qs: "etiquette_dpe:D", size: 5 });
    expect(result.total).toBe(1);
    expect(result.results[0]?.etiquette_dpe).toBe("D");

    const url = new URL(calls[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe(
      "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines",
    );
    expect(url.searchParams.get("qs")).toBe("etiquette_dpe:D");
    expect(url.searchParams.get("size")).toBe("5");
    expect(
      ((calls[0]?.init.headers ?? {}) as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("maps a 500 to UPSTREAM_UNAVAILABLE", async () => {
    const client = createAdemeClient({
      config,
      fetch: (async () => new Response("boom", { status: 500 })) as FetchLike,
    });
    await expect(client.searchDpe({ q: "x" })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});
