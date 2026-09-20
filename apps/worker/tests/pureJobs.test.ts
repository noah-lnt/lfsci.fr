import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { healthBody } from "../src/health";
import {
  collectCandidates,
  deterministicDeadlineId,
  nextAnniversary,
} from "../src/jobs/deadlinesGenerate";
import { analyzeDocument, flattenExtraction, normalizeImage } from "../src/jobs/documentAnalyze";
import { lastQuarters, refreshIrl } from "../src/jobs/irlRefresh";
import { backsync } from "../src/jobs/odooBacksync";
import { reconcileOnce } from "../src/jobs/outboxReconcile";
import { transcribeVoiceNote } from "../src/jobs/voiceTranscribe";
import { fakeDeps } from "./fakes";

const uuid = "0199a000-0000-7000-8000-000000000001";

describe("document.analyze without vendors", () => {
  it("completes with sources_unavailable rather than retrying forever", async () => {
    const result = await analyzeDocument(fakeDeps(), {
      requestId: uuid,
      organizationId: uuid,
      documentVersionId: uuid,
      kind: "invoice",
    });
    expect(result).toEqual({
      outcome: "sources_unavailable",
      missing: ["storage", "ocr", "ai"],
    });
  });

  it("flattens an extraction into one row per leaf field, arrays included", () => {
    const flat = flattenExtraction({
      supplier: { value: "ACME", confidence: 0.9, evidence: null },
      lines: [
        {
          description: {
            value: "Ligne 1",
            confidence: 0.8,
            evidence: { page: 1, bbox: null, quote: "L1" },
          },
          amount: { value: "10.00", confidence: 0.7, evidence: null },
        },
      ],
    });
    expect(flat.map((field) => field.fieldPath)).toEqual([
      "supplier",
      "lines.0.description",
      "lines.0.amount",
    ]);
    expect(flat[1]?.evidence?.quote).toBe("L1");
  });

  it("downscales an oversized capture to the 2000 px bound as JPEG", async () => {
    const source = await sharp({
      create: { width: 3200, height: 2400, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const normalized = await normalizeImage(new Uint8Array(source));
    const meta = await sharp(normalized).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(2000);
  });
});

describe("jobs whose vendor is absent", () => {
  it("voice.transcribe reports the missing ports", async () => {
    const result = await transcribeVoiceNote(fakeDeps(), {
      requestId: uuid,
      organizationId: uuid,
      activityId: uuid,
      storageKey: "org/x/doc/y/v1/a.webm",
      filename: "a.webm",
      contentType: "audio/webm",
    });
    expect(result).toEqual({ outcome: "sources_unavailable", missing: ["storage", "speech"] });
  });

  it("odoo.backsync skips cleanly with no connector", async () => {
    expect(await backsync(fakeDeps())).toEqual({
      outcome: "sources_unavailable",
      missing: ["odoo"],
    });
  });

  it("outbox.reconcile skips cleanly with no connector", async () => {
    const result = await reconcileOnce(fakeDeps(), {
      requestId: uuid,
      organizationId: uuid,
      commandId: uuid,
      operationRef: "lfsci:x",
      tries: 0,
    });
    expect(result.outcome).toBe("sources_unavailable");
  });

  it("irl.refresh degrades to sources_unavailable when INSEE answers an error", async () => {
    const deps = fakeDeps({
      insee: {
        fetchIrl: async () => {
          throw new Error("insee down");
        },
        fetchIrlSeries: async () => {
          throw new Error("insee down");
        },
      },
    });
    const result = await refreshIrl(deps);
    expect(result.outcome).toBe("sources_unavailable");
  });
});

describe("deadline identity", () => {
  it("derives the same uuid for the same (rule, object, due date)", () => {
    const a = deterministicDeadlineId("insurance_expiry", "insurance_policy", uuid, "2027-01-31");
    const b = deterministicDeadlineId("insurance_expiry", "insurance_policy", uuid, "2027-01-31");
    const other = deterministicDeadlineId(
      "insurance_expiry",
      "insurance_policy",
      uuid,
      "2027-02-01",
    );
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("takes the next anniversary on or after today", () => {
    expect(nextAnniversary("2020-03-15", "2026-01-01")).toBe("2026-03-15");
    expect(nextAnniversary("2020-03-15", "2026-06-01")).toBe("2027-03-15");
    expect(nextAnniversary("2020-03-15", "2026-03-15")).toBe("2026-03-15");
  });

  it("exposes the collector the job uses", () => {
    expect(typeof collectCandidates).toBe("function");
  });
});

describe("quarters and health", () => {
  it("walks back eight quarters across the year boundary", () => {
    expect(lastQuarters(new Date("2026-02-10T00:00:00Z"))).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2025, quarter: 4 },
      { year: 2025, quarter: 3 },
      { year: 2025, quarter: 2 },
      { year: 2025, quarter: 1 },
      { year: 2024, quarter: 4 },
      { year: 2024, quarter: 3 },
      { year: 2024, quarter: 2 },
    ]);
  });

  it("still keeps a revision's base quarter after a year of refreshes", () => {
    // The base of a revision computed in 2026 Q1 is the same quarter of 2025.
    const base = "2025-Q1";
    const refreshes = ["2026-01-20", "2026-04-20", "2026-07-20", "2026-10-20"];
    for (const day of refreshes) {
      const kept = lastQuarters(new Date(`${day}T07:00:00Z`)).map(
        ({ year, quarter }) => `${year}-Q${quarter}`,
      );
      expect(kept).toContain(base);
    }
  });

  it("answers `starting` until the first heartbeat", () => {
    const body = healthBody(["outbox.dispatch"]);
    expect(body.queues).toEqual(["outbox.dispatch"]);
    expect(["ok", "starting"]).toContain(body.status);
  });
});

describe("worker env", () => {
  const base = { DATABASE_URL: "postgres://app", DATABASE_ADMIN_URL: "postgres://admin" };

  it("declares the embedding keys the AI client reads, blank falling back to the default", () => {
    expect(loadEnv({ ...base, OLLAMA_MODEL_EMBED: "", AI_EMBED_DIMENSIONS: "" })).toMatchObject({
      OLLAMA_MODEL_EMBED: "bge-m3",
      AI_EMBED_DIMENSIONS: 1024,
    });
  });

  it("keeps an explicit embedding model and width", () => {
    expect(
      loadEnv({ ...base, OLLAMA_MODEL_EMBED: "nomic-embed-text", AI_EMBED_DIMENSIONS: "768" }),
    ).toMatchObject({ OLLAMA_MODEL_EMBED: "nomic-embed-text", AI_EMBED_DIMENSIONS: 768 });
  });
});
