import { describe, expect, it } from "vitest";
import { createOcrClient } from "../src/client";
import { OcrConfig } from "../src/config";
import type { FetchLike } from "../src/http";

const config = OcrConfig.parse({ apiKey: "test-key", baseUrl: "https://api.mistral.ai" });

const okBody = {
  pages: [
    {
      index: 0,
      markdown: "# Quittance\n\nLoyer 850,00 €",
      dimensions: { dpi: 200, height: 3300, width: 2550 },
    },
  ],
  model: "mistral-ocr-latest",
  usage_info: { pages_processed: 1, doc_size_bytes: 4096 },
};

function fakeFetch(
  respond: (url: string, init: RequestInit) => Response,
  calls: { url: string; init: RequestInit }[],
): FetchLike {
  return (async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call.url, call.init);
  }) as FetchLike;
}

describe("ocrDocument", () => {
  it("posts a pdf as a document_url data URL to /v1/ocr", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createOcrClient({
      config,
      fetch: fakeFetch(() => Response.json(okBody), calls),
    });

    const result = await client.ocrDocument({
      bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
      contentType: "application/pdf",
    });

    const call = calls[0];
    expect(call?.url).toBe("https://api.mistral.ai/v1/ocr");
    expect(call?.init.method).toBe("POST");
    expect(((call?.init.headers ?? {}) as Record<string, string>).authorization).toBe(
      "Bearer test-key",
    );
    expect(JSON.parse(String(call?.init.body))).toEqual({
      model: "mistral-ocr-latest",
      document: { type: "document_url", document_url: "data:application/pdf;base64,JVBERg==" },
      include_image_base64: false,
    });
    expect(result.pages[0]?.markdown).toContain("Quittance");
    expect(result.usage).toEqual({ pagesProcessed: 1, documentSizeBytes: 4096 });
  });

  it("sends an image as image_url", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createOcrClient({
      config,
      fetch: fakeFetch(() => Response.json(okBody), calls),
    });
    await client.ocrDocument({
      bytes: Uint8Array.from([0xff, 0xd8, 0xff]),
      contentType: "image/jpeg",
    });
    expect(JSON.parse(String(calls[0]?.init.body)).document.type).toBe("image_url");
  });

  it("refuses an unsupported media type before any call", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createOcrClient({
      config,
      fetch: fakeFetch(() => Response.json(okBody), calls),
    });
    await expect(
      client.ocrDocument({ bytes: Uint8Array.from([1, 2, 3]), contentType: "text/csv" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
    expect(calls).toHaveLength(0);
  });

  it("maps 429 to QUOTA_EXCEEDED, 400 to UPSTREAM_REJECTED and 503 to UPSTREAM_UNAVAILABLE", async () => {
    const cases: [number, string][] = [
      [429, "QUOTA_EXCEEDED"],
      [400, "UPSTREAM_REJECTED"],
      [503, "UPSTREAM_UNAVAILABLE"],
    ];
    for (const [status, code] of cases) {
      const client = createOcrClient({
        config,
        fetch: fakeFetch(() => new Response("nope", { status }), []),
      });
      await expect(
        client.ocrDocument({ bytes: Uint8Array.from([0x25]), contentType: "application/pdf" }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("maps a timeout on this idempotent call to UPSTREAM_UNAVAILABLE", async () => {
    const client = createOcrClient({
      config,
      fetch: (() =>
        Promise.reject(
          Object.assign(new Error("timed out"), { name: "TimeoutError" }),
        )) as FetchLike,
    });
    await expect(
      client.ocrDocument({ bytes: Uint8Array.from([0x25]), contentType: "application/pdf" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });

  it("rejects a response whose shape is not the documented one", async () => {
    const client = createOcrClient({
      config,
      fetch: (() => Promise.resolve(Response.json({ pages: "nope" }))) as FetchLike,
    });
    await expect(
      client.ocrDocument({ bytes: Uint8Array.from([0x25]), contentType: "application/pdf" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_REJECTED" });
  });
});
