import type { Storage } from "@lfsci/storage";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../../src/deps";
import { nightlyControls } from "../../src/jobs/controlsNightly";
import {
  exportPerson,
  pseudonymizePerson,
  purgeExpiredDocuments,
  purgeTranscribedAudio,
  readPolicy,
  runRetention,
} from "../../src/jobs/retentionPurge";
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

const NOW = new Date("2026-09-20T08:00:00.000Z");
const PERSON_ID = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";

function fakeStorage(): Storage & { deleted: string[] } {
  const deleted: string[] = [];
  return {
    deleted,
    client: {} as Storage["client"],
    presignUpload: async () => ({ url: "", fields: {}, key: "", expiresAt: "" }) as never,
    presignDownload: async () => "",
    headObject: async () => ({}) as never,
    deleteObject: async (key: string) => {
      deleted.push(key);
    },
  };
}

function deps(storage: ReturnType<typeof fakeStorage>): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb(), storage, now: () => NOW });
}

async function insertDocument(input: {
  id: string;
  retentionUntil?: string | null;
  legalHold?: boolean;
  authorPersonId?: string | null;
}): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO document (id, organization_id, title, nature, retention_class, retention_until,
                          legal_hold, author_person_id)
    VALUES (${input.id}::uuid, ${ORG_ID}::uuid, 'Pièce', 'application_file', 'application_3m',
            ${input.retentionUntil ?? null}::date, ${input.legalHold ?? false},
            ${input.authorPersonId ?? null}::uuid)
  `);
}

async function insertVersion(input: {
  id: string;
  documentId: string;
  sequence: number;
  role: string;
  contentType?: string;
  createdAt?: string;
  derivedFrom?: string | null;
}): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO document_version (id, organization_id, document_id, sequence, role, storage_key,
                                  content_type, byte_size, sha256, derived_from_version_id, created_at)
    VALUES (${input.id}::uuid, ${ORG_ID}::uuid, ${input.documentId}::uuid, ${input.sequence},
            ${input.role}, ${`demo/${input.id}`}, ${input.contentType ?? "application/pdf"},
            1024, ${"0".repeat(64)}, ${input.derivedFrom ?? null}::uuid,
            ${input.createdAt ?? NOW.toISOString()}::timestamptz)
  `);
  await adminDb().db.execute(sql`
    UPDATE document SET current_version_id = ${input.id}::uuid WHERE id = ${input.documentId}::uuid
  `);
}

async function insertPerson(retentionHold = false): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO person (id, organization_id, display_name, first_name, last_name, birth_date,
                        national_id_ref, retention_hold)
    VALUES (${PERSON_ID}::uuid, ${ORG_ID}::uuid, 'Alex Durand', 'Alex', 'Durand', '1980-04-02',
            'REF-1', ${retentionHold})
  `);
  await adminDb().db.execute(sql`
    INSERT INTO contact_point (organization_id, person_id, kind, value)
    VALUES (${ORG_ID}::uuid, ${PERSON_ID}::uuid, 'email', 'alex.durand@exemple.test')
  `);
}

async function objectRefForDocument(documentId: string): Promise<string> {
  const rows = await adminDb().db.execute<{ id: string }>(sql`
    INSERT INTO object_ref (organization_id, kind, document_id)
    VALUES (${ORG_ID}::uuid, 'document', ${documentId}::uuid)
    RETURNING id
  `);
  return [...rows][0]?.id ?? "";
}

async function indexDocument(documentId: string, objectRefId: string): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO search_document (organization_id, object_ref_id, source_table, source_id, body, tsv)
    VALUES (${ORG_ID}::uuid, ${objectRefId}::uuid, 'document', ${documentId}::uuid,
            'texte océrisé', to_tsvector('french', 'texte océrisé'))
  `);
  const vector = `[${Array.from({ length: 1024 }, () => 0).join(",")}]`;
  await adminDb().db.execute(sql`
    INSERT INTO embedding (organization_id, object_ref_id, source_table, source_id, chunk_text,
                           model_name, dimensions, vector)
    VALUES (${ORG_ID}::uuid, ${objectRefId}::uuid, 'document', ${documentId}::uuid,
            'texte océrisé', 'test-embed', 1024, ${vector}::vector)
  `);
}

async function insertExchange(ageDays: number): Promise<void> {
  await adminDb().db.execute(sql`
    INSERT INTO integration_exchange (organization_id, integration, direction, operation, created_at)
    VALUES (${ORG_ID}::uuid, 'odoo', 'outbound', 'execute_kw',
            now() - make_interval(days => ${ageDays}))
  `);
}

async function countOf(table: string): Promise<number> {
  const rows = await adminDb().db.execute<{ count: string }>(
    sql.raw(`SELECT count(*)::text AS count FROM ${table}`),
  );
  return Number([...rows][0]?.count ?? 0);
}

const DOC_A = "10000000-0000-4000-8000-00000000000a";
const DOC_B = "10000000-0000-4000-8000-00000000000b";
const DOC_C = "10000000-0000-4000-8000-00000000000c";
const VERSION = (suffix: string) => `20000000-0000-4000-8000-00000000000${suffix}`;

run("retention.purge", () => {
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

  it("purges a document the day after its retention date and not the day of", async () => {
    await insertDocument({ id: DOC_A, retentionUntil: "2026-09-19" });
    await insertVersion({ id: VERSION("1"), documentId: DOC_A, sequence: 1, role: "original" });
    await insertDocument({ id: DOC_B, retentionUntil: "2026-09-20" });
    await insertVersion({ id: VERSION("2"), documentId: DOC_B, sequence: 1, role: "original" });

    const storage = fakeStorage();
    const result = await purgeExpiredDocuments(deps(storage), ORG_ID);

    expect(result).toMatchObject({ documents: 1, versions: 1, blobs: 1 });
    expect(storage.deleted).toEqual([`demo/${VERSION("1")}`]);
    const rows = await adminDb().db.execute<{ id: string; status: string }>(
      sql`SELECT id, status FROM document ORDER BY id`,
    );
    expect([...rows]).toEqual([
      { id: DOC_A, status: "purged" },
      { id: DOC_B, status: "active" },
    ]);
    expect(await countOf("document_version")).toBe(1);
  });

  it("keeps an expired document under legal hold", async () => {
    await insertDocument({ id: DOC_A, retentionUntil: "2026-01-01", legalHold: true });
    await insertVersion({ id: VERSION("1"), documentId: DOC_A, sequence: 1, role: "original" });

    const storage = fakeStorage();
    const result = await purgeExpiredDocuments(deps(storage), ORG_ID);

    expect(result.documents).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it("ignores a document with no retention date at all", async () => {
    await insertDocument({ id: DOC_C, retentionUntil: null });
    await insertVersion({ id: VERSION("3"), documentId: DOC_C, sequence: 1, role: "original" });

    expect((await purgeExpiredDocuments(deps(fakeStorage()), ORG_ID)).documents).toBe(0);
  });

  it("drops the index and the embeddings built from a purged document", async () => {
    await insertDocument({ id: DOC_A, retentionUntil: "2026-09-19" });
    await insertVersion({ id: VERSION("1"), documentId: DOC_A, sequence: 1, role: "original" });
    const ref = await objectRefForDocument(DOC_A);
    await indexDocument(DOC_A, ref);

    await purgeExpiredDocuments(deps(fakeStorage()), ORG_ID);

    expect(await countOf("search_document")).toBe(0);
    expect(await countOf("embedding")).toBe(0);
  });

  it("deletes the audio once the transcript is older than the window, not before", async () => {
    await insertDocument({ id: DOC_A, retentionUntil: null });
    await insertVersion({
      id: VERSION("1"),
      documentId: DOC_A,
      sequence: 1,
      role: "original",
      contentType: "audio/webm",
    });
    await insertVersion({
      id: VERSION("2"),
      documentId: DOC_A,
      sequence: 2,
      role: "transcript",
      contentType: "text/plain",
      derivedFrom: VERSION("1"),
      createdAt: "2026-09-14T08:00:00.000Z",
    });

    const policy = { voiceAudioDays: 7, integrationExchangeDays: 30 };
    const early = await purgeTranscribedAudio(deps(fakeStorage()), ORG_ID, policy);
    expect(early.versions).toBe(0);

    await adminDb().db.execute(sql`
      UPDATE document_version SET created_at = '2026-09-12T08:00:00.000Z'
       WHERE id = ${VERSION("2")}::uuid
    `);

    const storage = fakeStorage();
    const late = await purgeTranscribedAudio(deps(storage), ORG_ID, policy);

    expect(late).toEqual({ versions: 1, blobs: 1 });
    expect(storage.deleted).toEqual([`demo/${VERSION("1")}`]);
    const rows = await adminDb().db.execute<{ role: string }>(
      sql`SELECT role FROM document_version`,
    );
    expect([...rows].map((row) => row.role)).toEqual(["transcript"]);
    const current = await adminDb().db.execute<{ current_version_id: string | null }>(
      sql`SELECT current_version_id FROM document WHERE id = ${DOC_A}::uuid`,
    );
    expect([...current][0]?.current_version_id).toBe(VERSION("2"));
  });

  it("keeps audio that has never been transcribed", async () => {
    await insertDocument({ id: DOC_A, retentionUntil: null });
    await insertVersion({
      id: VERSION("1"),
      documentId: DOC_A,
      sequence: 1,
      role: "original",
      contentType: "audio/webm",
      createdAt: "2025-01-01T08:00:00.000Z",
    });

    const result = await purgeTranscribedAudio(deps(fakeStorage()), ORG_ID, {
      voiceAudioDays: 7,
      integrationExchangeDays: 30,
    });

    expect(result.versions).toBe(0);
  });

  it("reads the window from the organization's retention rules", async () => {
    const definition = { dataClass: "voice_audio", activeDays: 3, action: "delete" };
    await adminDb().db.execute(sql`
      INSERT INTO rule (id, organization_id, code, domain, label, status)
      VALUES (${VERSION("9")}::uuid, ${ORG_ID}::uuid, 'retention.voice_audio', 'retention',
              'Audio brut', 'active')
    `);
    await adminDb().db.execute(sql`
      INSERT INTO rule_version (organization_id, rule_id, sequence, definition, definition_hash,
                                effective_from, status)
      VALUES (${ORG_ID}::uuid, ${VERSION("9")}::uuid, 1, ${JSON.stringify(definition)}::jsonb,
              'hash', '2026-01-01', 'active')
    `);

    const policy = await appDb().db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.organization_id', ${ORG_ID}, true)`);
      await tx.execute(sql.raw("SET LOCAL ROLE lfsci_app"));
      return readPolicy(tx, ORG_ID);
    });

    expect(policy).toEqual({ voiceAudioDays: 3, integrationExchangeDays: 30 });
  });

  it("refuses to pseudonymize a person under a retention hold", async () => {
    await insertPerson(true);

    const result = await pseudonymizePerson(deps(fakeStorage()), ORG_ID, PERSON_ID);

    expect(result).toEqual({ outcome: "refused", reason: "retention_hold" });
  });

  it("pseudonymizes the person and everything derived from their documents", async () => {
    await insertPerson();
    await insertDocument({ id: DOC_A, retentionUntil: null, authorPersonId: PERSON_ID });
    await insertVersion({ id: VERSION("1"), documentId: DOC_A, sequence: 1, role: "original" });
    await insertVersion({
      id: VERSION("2"),
      documentId: DOC_A,
      sequence: 2,
      role: "ocr_text",
      contentType: "text/plain",
      derivedFrom: VERSION("1"),
    });
    const ref = await objectRefForDocument(DOC_A);
    await indexDocument(DOC_A, ref);

    const storage = fakeStorage();
    const result = await pseudonymizePerson(deps(storage), ORG_ID, PERSON_ID);

    expect(result).toMatchObject({ outcome: "pseudonymized", contactPoints: 1, blobs: 1 });
    expect(storage.deleted).toEqual([`demo/${VERSION("2")}`]);

    const person = await adminDb().db.execute<{
      display_name: string;
      first_name: string | null;
      national_id_ref: string | null;
      status: string;
    }>(sql`SELECT display_name, first_name, national_id_ref, status FROM person`);
    expect([...person][0]).toEqual({
      display_name: "Personne anonymisée",
      first_name: null,
      national_id_ref: null,
      status: "pseudonymized",
    });

    const contact = await adminDb().db.execute<{ value: string; status: string }>(
      sql`SELECT value, status FROM contact_point`,
    );
    expect([...contact][0]).toEqual({ value: "supprimé", status: "revoked" });

    expect(await countOf("search_document")).toBe(0);
    expect(await countOf("embedding")).toBe(0);
    // The original survives: erasure reaches the derivations, not the evidence.
    const roles = await adminDb().db.execute<{ role: string }>(
      sql`SELECT role FROM document_version`,
    );
    expect([...roles].map((row) => row.role)).toEqual(["original"]);
  });

  it("exports what the base holds about one person", async () => {
    await insertPerson();

    const result = await exportPerson(deps(fakeStorage()), ORG_ID, PERSON_ID);

    expect(result.person).toMatchObject({ display_name: "Alex Durand" });
    expect(result.contactPoints).toHaveLength(1);
    expect(result.exportedAt).toBe(NOW.toISOString());
  });

  it("sweeps every organization and reports what it removed", async () => {
    await insertDocument({ id: DOC_A, retentionUntil: "2026-09-19" });
    await insertVersion({ id: VERSION("1"), documentId: DOC_A, sequence: 1, role: "original" });

    const outcome = await runRetention(deps(fakeStorage()), {
      requestId: "0199a000-0000-7000-8000-000000000001",
      mode: "purge",
    });

    expect(outcome).toMatchObject({
      outcome: "completed",
      organizations: 1,
      documents: 1,
      documentVersions: 1,
    });
  });
  it("purges the expired integration exchanges, which the nightly controls leave alone", async () => {
    await insertExchange(45);
    await insertExchange(2);

    const controls = await nightlyControls(deps(fakeStorage()));
    expect(controls).toMatchObject({ outcome: "completed" });
    expect(controls.exchangesPurged).toBeUndefined();
    expect(await countOf("integration_exchange")).toBe(2);

    const outcome = await runRetention(deps(fakeStorage()), {
      requestId: "0199a000-0000-7000-8000-000000000002",
      mode: "purge",
    });

    expect(outcome).toMatchObject({ outcome: "completed", exchanges: 1 });
    expect(await countOf("integration_exchange")).toBe(1);
  });
});
