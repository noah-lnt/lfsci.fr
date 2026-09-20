import { createHash } from "node:crypto";
import type { OcrClient } from "@lfsci/ocr";
import type { Storage } from "@lfsci/storage";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../../src/deps";
import { analyzeDocument } from "../../src/jobs/documentAnalyze";
import {
  adminDb,
  appDb,
  closeDbs,
  migrate,
  ORG_ID,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "../db";
import { fakeDeps } from "../fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001";
const VERSION_ID = "30000000-0000-4000-8000-000000000002";
const STORAGE_KEY = "org/facture.pdf";
const PDF = Buffer.from("%PDF-1.4\nfacture\n%%EOF\n");

/** The presigned URL is a data: URL, so the job's own `fetch` reads the bytes. */
function storageServing(bytes: Buffer): Storage {
  return {
    presignDownload: async () => `data:application/pdf;base64,${bytes.toString("base64")}`,
  } as unknown as Storage;
}

const OCR_REACHED = "ocr reached";

function ocrSentinel(): OcrClient {
  return {
    ocrDocument: async () => {
      throw new Error(OCR_REACHED);
    },
  } as unknown as OcrClient;
}

function deps(bytes: Buffer): Deps {
  return fakeDeps({
    db: appDb(),
    admin: adminDb(),
    storage: storageServing(bytes),
    ocr: ocrSentinel(),
    ai: { provider: "ollama" } as unknown as NonNullable<Deps["ai"]>,
  });
}

async function seedVersion(sha256: string): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO document (id, organization_id, title, nature)
    VALUES (${DOCUMENT_ID}::uuid, ${ORG_ID}::uuid, 'Facture', 'supplier_invoice')
  `);
  await db.execute(sql`
    INSERT INTO document_version (id, organization_id, document_id, sequence, role, storage_key,
                                  content_type, byte_size, sha256)
    VALUES (${VERSION_ID}::uuid, ${ORG_ID}::uuid, ${DOCUMENT_ID}::uuid, 1, 'original',
            ${STORAGE_KEY}, 'application/pdf', ${PDF.byteLength}, ${sha256})
  `);
}

function job() {
  return {
    requestId: "0199a000-0000-7000-8000-000000000003",
    organizationId: ORG_ID,
    documentVersionId: VERSION_ID,
    kind: "invoice" as const,
  };
}

run("document.analyze checksum", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("refuses the job when the stored bytes do not hash to what the version records", async () => {
    await seedVersion("f".repeat(64));

    await expect(analyzeDocument(deps(PDF), job())).rejects.toThrow(/empreinte du fichier/);
  });

  it("recomputes the hash before the OCR call, not from the payload", async () => {
    await seedVersion(createHash("sha256").update(PDF).digest("hex"));

    await expect(analyzeDocument(deps(PDF), job())).rejects.toThrow(OCR_REACHED);
  });
});
