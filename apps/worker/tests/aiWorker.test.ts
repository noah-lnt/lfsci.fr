import { execFileSync } from "node:child_process";
import type { AiClient } from "@lfsci/ai";
import { describe, expect, it } from "vitest";
import { healthBody } from "../src/health";
import { createModelHealth, statusOf } from "../src/health-model";
import {
  analyzeDocument,
  MAX_PAGE_EDGE,
  MAX_PDF_PAGES,
  type PageRenderer,
  PDFTOPPM_BINARY,
  popplerRenderer,
  rasteriseForModel,
} from "../src/jobs/documentAnalyze";
import { chunkTextOf, indexVectors, withOverlap } from "../src/jobs/searchIndex";
import { fakeDeps } from "./fakes";

const uuid = "0199a000-0000-7000-8000-000000000001";

/** The worker image installs poppler; a developer machine or a runner may not have it. */
function hasPoppler(): boolean {
  try {
    execFileSync("which", [PDFTOPPM_BINARY], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A one-page PDF built by hand: enough for poppler to read a page box. */
function tinyPdf(): Uint8Array {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>>>endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}

function aiStub(overrides: Partial<AiClient> = {}): AiClient {
  return {
    provider: "ollama",
    modelId: "qwen3:32b",
    embedModelId: "bge-m3",
    embedDimensions: 1024,
    supportsServerSideFallback: false,
    extract: async () => ({
      ok: false,
      reason: "upstream",
      code: "UPSTREAM_UNAVAILABLE",
      upstreamRequestId: null,
      detail: "not called in this test",
    }),
    assistant: async () => ({ ok: true, stopReason: "end_turn" }),
    embed: async () => ({
      ok: false,
      reason: "upstream",
      code: "UPSTREAM_UNAVAILABLE",
      detail: "ollama unreachable",
    }),
    health: async () => null,
    ...overrides,
  };
}

describe.skipIf(!hasPoppler())("pdf rasterisation through poppler", () => {
  it("renders a page to a jpeg the vision model can read", async () => {
    const pages = await popplerRenderer({
      pdf: tinyPdf(),
      maxPages: MAX_PDF_PAGES,
      maxEdgePx: MAX_PAGE_EDGE,
    });
    expect(pages).toHaveLength(1);
    expect(pages[0]?.mediaType).toBe("image/jpeg");
    // SOI marker of a JPEG stream, base64-encoded.
    expect(pages[0]?.base64.startsWith("/9j/")).toBe(true);
  });

  it("refuses bytes that are not a pdf instead of returning an empty page", async () => {
    await expect(
      popplerRenderer({
        pdf: new Uint8Array(Buffer.from("this is not a pdf")),
        maxPages: 1,
        maxEdgePx: 200,
      }),
    ).rejects.toThrow();
  });
});

describe("rasterisation degrades instead of failing the job", () => {
  const page = { base64: "/9j/", mediaType: "image/jpeg" as const };

  it("passes the rendered pages through when the renderer succeeds", async () => {
    const result = await rasteriseForModel(async () => [page], new Uint8Array());
    expect(result).toEqual({ pages: [page], degraded: null });
  });

  it("reports the renderer's failure and hands back no page", async () => {
    const result = await rasteriseForModel(async () => {
      throw new Error("pdftoppm not found");
    }, new Uint8Array());
    expect(result.pages).toEqual([]);
    expect(result.degraded).toBe("pdftoppm not found");
  });

  it("treats an empty render as degraded, not as a document with no page", async () => {
    const result = await rasteriseForModel(async () => [], new Uint8Array());
    expect(result.degraded).toBe("renderer produced no page");
  });

  it("still reports the missing ports before it reaches the renderer", async () => {
    const renderer: PageRenderer = async () => {
      throw new Error("the renderer must not be called without storage");
    };
    const result = await analyzeDocument(
      fakeDeps(),
      { requestId: uuid, organizationId: uuid, documentVersionId: uuid, kind: "invoice" },
      renderer,
    );
    expect(result).toEqual({ outcome: "sources_unavailable", missing: ["storage", "ocr", "ai"] });
  });
});

describe("model health", () => {
  it("is down when the instance answers but a configured model is missing", () => {
    expect(
      statusOf({ reachable: true, installed: ["qwen3:32b"], missing: ["bge-m3"], detail: null }),
    ).toBe("down");
    expect(statusOf({ reachable: true, installed: [], missing: [], detail: null })).toBe("up");
    expect(statusOf({ reachable: false, installed: [], missing: ["x"], detail: "no" })).toBe(
      "down",
    );
    expect(statusOf(null)).toBe("unknown");
  });

  it("probes once per TTL rather than on every request", async () => {
    let calls = 0;
    let clock = 0;
    const health = createModelHealth(
      async () => {
        calls += 1;
        return { reachable: true, installed: [], missing: [], detail: null };
      },
      { ttlMs: 1000, now: () => new Date(clock), provider: () => "ollama" },
    );

    expect((await health.read()).status).toBe("up");
    await health.read();
    expect(calls).toBe(1);
    clock += 1001;
    await health.read();
    expect(calls).toBe(2);
  });

  it("reports down instead of rejecting when the probe throws", async () => {
    const health = createModelHealth(
      async () => {
        throw new Error("boom");
      },
      { ttlMs: 0, provider: () => "ollama" },
    );
    const component = await health.read();
    expect(component.status).toBe("down");
    expect(component.detail).toBe("boom");
  });

  it("carries the model component on the worker health body without gating the status", () => {
    const body = healthBody(["search.index"]);
    expect(body.model.status).toBe("unknown");
    expect(["ok", "starting"]).toContain(body.status);
  });
});

describe("search.index degradation", () => {
  it("skips the vector half when no provider is configured", async () => {
    expect(await indexVectors(fakeDeps(), uuid)).toEqual({
      embedded: 0,
      skipped: "ai_unconfigured",
    });
  });

  it("skips the vector half when the provider exposes no embeddings", async () => {
    const deps = fakeDeps({ ai: aiStub({ embedModelId: "" }) });
    expect(await indexVectors(deps, uuid)).toEqual({
      embedded: 0,
      skipped: "provider_has_no_embeddings",
    });
  });

  it("joins the title and the body into one chunk, capped", () => {
    expect(chunkTextOf({ title: "Bail lot A", body: "signé le 1er mars" })).toBe(
      "Bail lot A\nsigné le 1er mars",
    );
    expect(chunkTextOf({ title: null, body: null })).toBe("");
    expect(chunkTextOf({ title: "x".repeat(9000), body: null })).toHaveLength(4000);
  });

  it("rewinds the cursor by the overlap and falls back to the epoch on a bad value", () => {
    expect(withOverlap("2026-09-20T10:00:00.000+00:00")).toBe("2026-09-20T09:55:00.000Z");
    expect(withOverlap("not a date")).toBe("1970-01-01T00:00:00.000+00:00");
  });
});
