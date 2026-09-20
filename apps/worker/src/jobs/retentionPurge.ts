import type { Tx } from "@lfsci/db";
import { purgeExchanges, recordAudit, withoutTenant, withTenant } from "@lfsci/db";
import { AppError, logger } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.retention.purge");

/** Derived versions a person's erasure must reach (spec RGPD-03). */
export const DERIVED_ROLES = ["ocr_text", "transcript", "thumbnail", "summary"] as const;

/**
 * Fallbacks used when an organization has no `rule` row yet. They are the
 * proposal of spec RGPD-02, which the owner validates before production; the
 * seeded rules are what a running organization reads.
 */
export const DEFAULT_RETENTION = {
  voice_audio_days: 7,
  integration_exchange_days: 30,
} as const;

export type RetentionPolicy = {
  voiceAudioDays: number;
  integrationExchangeDays: number;
};

export const RetentionPurgeData = JobBase.extend({
  mode: z.enum(["purge", "export", "pseudonymize"]).default("purge"),
  personId: z.uuid().optional(),
});
export type RetentionPurgeData = z.infer<typeof RetentionPurgeData>;

type DefinitionRow = { data_class: string | null; active_days: number | null };

export async function readPolicy(tx: Tx, organizationId: string): Promise<RetentionPolicy> {
  const rows = await tx.execute<DefinitionRow>(sql`
    SELECT v.definition ->> 'dataClass' AS data_class,
           (v.definition ->> 'activeDays')::int AS active_days
      FROM rule r
      JOIN rule_version v ON v.rule_id = r.id
     WHERE r.organization_id = ${organizationId}::uuid
       AND r.domain = 'retention'
       AND r.status = 'active'
       AND v.status = 'active'
  `);
  const byClass = new Map<string, number>();
  for (const row of rows) {
    if (row.data_class && row.active_days !== null) byClass.set(row.data_class, row.active_days);
  }
  return {
    voiceAudioDays: byClass.get("voice_audio") ?? DEFAULT_RETENTION.voice_audio_days,
    integrationExchangeDays:
      byClass.get("integration_exchange") ?? DEFAULT_RETENTION.integration_exchange_days,
  };
}

async function deleteBlobs(deps: Deps, keys: string[]): Promise<number> {
  if (keys.length === 0 || !deps.storage) return 0;
  let removed = 0;
  for (const key of keys) {
    try {
      await deps.storage.deleteObject(key);
      removed += 1;
    } catch (error) {
      log.error({ err: error, key }, "storage object could not be removed");
    }
  }
  return removed;
}

type VersionRow = { id: string; document_id: string; storage_key: string };

/**
 * DOC-01 keeps the original and its derivations in one chain, so the audio row
 * cannot simply be deleted: the transcript points at it and the document may
 * still name it as its current version.
 */
async function detachVersions(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`
    UPDATE document_version SET derived_from_version_id = NULL
     WHERE derived_from_version_id = ANY(${sql.param(ids)}::uuid[])
  `);
  await tx.execute(sql`
    UPDATE document d
       SET current_version_id = (
             SELECT v.id FROM document_version v
              WHERE v.document_id = d.id AND v.id <> ALL(${sql.param(ids)}::uuid[])
              ORDER BY v.sequence DESC LIMIT 1
           )
     WHERE d.current_version_id = ANY(${sql.param(ids)}::uuid[])
  `);
  await tx.execute(sql`DELETE FROM document_version WHERE id = ANY(${sql.param(ids)}::uuid[])`);
}

export async function purgeTranscribedAudio(
  deps: Deps,
  organizationId: string,
  policy: RetentionPolicy,
): Promise<{ versions: number; blobs: number }> {
  const now = deps.now();
  const expired = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx.execute<VersionRow>(sql`
      SELECT audio.id, audio.document_id, audio.storage_key
        FROM document_version audio
        JOIN document_version transcript
          ON transcript.document_id = audio.document_id
         AND transcript.role = 'transcript'
       WHERE audio.role = 'original'
         AND audio.content_type LIKE 'audio/%'
         AND transcript.created_at <= ${now.toISOString()}::timestamptz
             - make_interval(days => ${policy.voiceAudioDays})
       ORDER BY audio.created_at
    `);
    return [...rows];
  });

  if (expired.length === 0) return { versions: 0, blobs: 0 };

  const blobs = await deleteBlobs(
    deps,
    expired.map((row) => row.storage_key),
  );

  await withTenant(deps.db, { organizationId }, async (tx) => {
    await detachVersions(
      tx,
      expired.map((row) => row.id),
    );
    await recordAudit(tx, {
      organizationId,
      actorKind: "system",
      objectTable: "document_version",
      action: "retention.audio_purged",
      source: "retention.purge",
      afterValue: { versions: expired.length, days: policy.voiceAudioDays },
    });
  });

  return { versions: expired.length, blobs };
}

type DocumentRow = { id: string; object_ref_id: string | null };

/**
 * RGPD-02: `retention_until` is the exit date of the class the document was
 * filed under, and `legal_hold` freezes it whatever that date says. The
 * original and every derivation go, the row stays `purged` so the lease, the
 * receipt or the audit entry that names it still resolves.
 */
export async function purgeExpiredDocuments(
  deps: Deps,
  organizationId: string,
): Promise<{ documents: number; versions: number; blobs: number }> {
  const today = deps.now().toISOString().slice(0, 10);

  const found = await withTenant(deps.db, { organizationId }, async (tx) => {
    const documents = await tx.execute<DocumentRow>(sql`
      SELECT d.id, r.id AS object_ref_id
        FROM document d
        LEFT JOIN object_ref r ON r.document_id = d.id
       WHERE d.retention_until IS NOT NULL
         AND d.retention_until < ${today}::date
         AND d.legal_hold = false
         AND d.status <> 'purged'
       ORDER BY d.retention_until
    `);
    const ids = [...documents].map((row) => row.id);
    if (ids.length === 0) return { ids, refs: [] as string[], versions: [] as VersionRow[] };
    const versions = await tx.execute<VersionRow>(sql`
      SELECT id, document_id, storage_key FROM document_version
       WHERE document_id = ANY(${sql.param(ids)}::uuid[])
    `);
    return {
      ids,
      refs: [...documents].map((row) => row.object_ref_id).filter((ref): ref is string => !!ref),
      versions: [...versions],
    };
  });

  if (found.ids.length === 0) return { documents: 0, versions: 0, blobs: 0 };

  const blobs = await deleteBlobs(
    deps,
    found.versions.map((row) => row.storage_key),
  );

  await withTenant(deps.db, { organizationId }, async (tx) => {
    await detachVersions(
      tx,
      found.versions.map((row) => row.id),
    );
    await dropDerivedIndexes(tx, found.refs);
    await tx.execute(sql`
      UPDATE document
         SET status = 'purged', purged_at = now(), current_version_id = NULL,
             updated_at = now(), version = version + 1
       WHERE id = ANY(${sql.param(found.ids)}::uuid[])
    `);
    await recordAudit(tx, {
      organizationId,
      actorKind: "system",
      objectTable: "document",
      action: "retention.document_purged",
      source: "retention.purge",
      afterValue: { documents: found.ids.length, versions: found.versions.length },
    });
  });

  return { documents: found.ids.length, versions: found.versions.length, blobs };
}

/** RGPD-03: the index and the vectors are derivatives, never the source. */
async function dropDerivedIndexes(tx: Tx, objectRefIds: string[]): Promise<void> {
  if (objectRefIds.length === 0) return;
  await tx.execute(
    sql`DELETE FROM search_document WHERE object_ref_id = ANY(${sql.param(objectRefIds)}::uuid[])`,
  );
  await tx.execute(
    sql`DELETE FROM embedding WHERE object_ref_id = ANY(${sql.param(objectRefIds)}::uuid[])`,
  );
}

export type PersonExport = {
  person: Record<string, unknown> | undefined;
  contactPoints: Record<string, unknown>[];
  roles: Record<string, unknown>[];
  leaseParties: Record<string, unknown>[];
  activities: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  extractions: Record<string, unknown>[];
  exportedAt: string;
};

/** RGPD-01 right of access: everything the base holds about one person. */
export async function exportPerson(
  deps: Deps,
  organizationId: string,
  personId: string,
): Promise<PersonExport> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = async (query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> => [
      ...(await tx.execute<Record<string, unknown>>(query)),
    ];
    const person = await rows(sql`SELECT * FROM person WHERE id = ${personId}::uuid`);
    return {
      person: person[0],
      contactPoints: await rows(
        sql`SELECT * FROM contact_point WHERE person_id = ${personId}::uuid ORDER BY created_at`,
      ),
      roles: await rows(
        sql`SELECT * FROM person_role WHERE person_id = ${personId}::uuid ORDER BY starts_on`,
      ),
      leaseParties: await rows(
        sql`SELECT * FROM lease_party WHERE person_id = ${personId}::uuid ORDER BY starts_on`,
      ),
      activities: await rows(
        sql`SELECT * FROM activity WHERE author_person_id = ${personId}::uuid ORDER BY occurred_at`,
      ),
      documents: await rows(
        sql`SELECT * FROM document WHERE author_person_id = ${personId}::uuid ORDER BY created_at`,
      ),
      extractions: await rows(sql`
        SELECT e.* FROM ai_extraction e
          JOIN activity a ON a.id = e.source_activity_id
         WHERE a.author_person_id = ${personId}::uuid
         ORDER BY e.created_at
      `),
      exportedAt: deps.now().toISOString(),
    };
  });
}

export type PseudonymizeResult = {
  outcome: "pseudonymized" | "refused" | "not_found";
  reason?: string;
  contactPoints?: number;
  derivedVersions?: number;
  blobs?: number;
};

/**
 * RGPD-01/03 erasure: the row survives because leases, receipts and the audit
 * chain depend on it; what identifies the person does not, and neither do the
 * OCR text, the thumbnails, the index or the embeddings built from it.
 */
export async function pseudonymizePerson(
  deps: Deps,
  organizationId: string,
  personId: string,
): Promise<PseudonymizeResult> {
  const state = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx.execute<{ retention_hold: boolean; pseudonymized_at: string | null }>(
      sql`SELECT retention_hold, pseudonymized_at FROM person WHERE id = ${personId}::uuid`,
    );
    return [...rows][0];
  });
  if (!state) return { outcome: "not_found" };
  if (state.retention_hold) return { outcome: "refused", reason: "retention_hold" };

  const derived = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx.execute<VersionRow>(sql`
      SELECT v.id, v.document_id, v.storage_key
        FROM document_version v
        JOIN document d ON d.id = v.document_id
       WHERE d.author_person_id = ${personId}::uuid
         AND v.role = ANY(${sql.param([...DERIVED_ROLES])}::text[])
    `);
    return [...rows];
  });

  const blobs = await deleteBlobs(
    deps,
    derived.map((row) => row.storage_key),
  );

  const contactPoints = await withTenant(deps.db, { organizationId }, async (tx) => {
    await detachVersions(
      tx,
      derived.map((row) => row.id),
    );

    const refs = await tx.execute<{ id: string }>(sql`
      SELECT r.id FROM object_ref r
       WHERE r.person_id = ${personId}::uuid
          OR r.document_id IN (SELECT id FROM document WHERE author_person_id = ${personId}::uuid)
    `);
    await dropDerivedIndexes(
      tx,
      [...refs].map((row) => row.id),
    );

    const updated = await tx.execute<{ id: string }>(sql`
      UPDATE contact_point
         SET value = 'supprimé', label = NULL, status = 'revoked',
             updated_at = now(), version = version + 1
       WHERE person_id = ${personId}::uuid AND status <> 'revoked'
      RETURNING id
    `);

    await tx.execute(sql`
      UPDATE person
         SET display_name = 'Personne anonymisée', first_name = NULL, last_name = NULL,
             company_name = NULL, birth_date = NULL, national_id_ref = NULL,
             status = 'pseudonymized', pseudonymized_at = now(),
             updated_at = now(), version = version + 1
       WHERE id = ${personId}::uuid
    `);

    await recordAudit(tx, {
      organizationId,
      actorKind: "system",
      objectTable: "person",
      objectId: personId,
      action: "rgpd.pseudonymized",
      source: "retention.purge",
      afterValue: { contactPoints: [...updated].length, derivedVersions: derived.length },
    });

    return [...updated].length;
  });

  return {
    outcome: "pseudonymized",
    contactPoints,
    derivedVersions: derived.length,
    blobs,
  };
}

export async function runRetention(deps: Deps, data: RetentionPurgeData): Promise<JobOutcome> {
  if (data.mode !== "purge") {
    if (!data.organizationId || !data.personId) {
      throw new AppError("VALIDATION", {
        message: "organizationId and personId are required for a per-person request",
      });
    }
    if (data.mode === "export") {
      const result = await exportPerson(deps, data.organizationId, data.personId);
      return { outcome: "exported", personId: data.personId, export: result };
    }
    const result = await pseudonymizePerson(deps, data.organizationId, data.personId);
    return { ...result, outcome: result.outcome, personId: data.personId };
  }

  const organizationIds = data.organizationId
    ? [data.organizationId]
    : await forEachOrganizationId(deps);

  let audioVersions = 0;
  let documents = 0;
  let documentVersions = 0;
  let blobs = 0;
  let exchangeDays: number = DEFAULT_RETENTION.integration_exchange_days;

  for (const organizationId of organizationIds) {
    const policy = await withTenant(deps.db, { organizationId }, (tx) =>
      readPolicy(tx, organizationId),
    );
    exchangeDays = policy.integrationExchangeDays;

    const audio = await purgeTranscribedAudio(deps, organizationId, policy);
    const expired = await purgeExpiredDocuments(deps, organizationId);

    audioVersions += audio.versions;
    documents += expired.documents;
    documentVersions += expired.versions;
    blobs += audio.blobs + expired.blobs;
  }

  const exchanges = await withoutTenant(deps.admin, (tx) => purgeExchanges(tx, exchangeDays));

  return {
    outcome: "completed",
    organizations: organizationIds.length,
    audioVersions,
    documents,
    documentVersions,
    blobs,
    exchanges,
  };
}

export const retentionPurge = defineJob({
  name: "retention.purge",
  schema: RetentionPurgeData,
  options: {
    retryLimit: 1,
    retryDelay: 900,
    retryBackoff: false,
    expireInSeconds: 1800,
    localConcurrency: 1,
  },
  schedule: { cron: "15 3 * * *", tz: "Europe/Paris" },
  handler: (data, deps) => runRetention(deps, data),
});
