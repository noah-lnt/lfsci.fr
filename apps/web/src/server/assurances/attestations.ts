import "server-only";
import { ensureObjectRef, linkActivity, type Tx, tables } from "@lfsci/db";
import { type AttestationFields, matchAttestation, type PolicyCandidate } from "@lfsci/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AttachAttestationInput,
  AttachAttestationResult,
  AttestationCandidate,
  ExtractedAttestation,
} from "@/lib/contracts/assurances";
import { type Actor, audit, recordFact } from "../finance/facts";
import { firstOr, ruleViolation, versionConflict } from "../finance/shared";
import { CERTIFICATE_DEADLINE_TYPE, getPolicy, syncCertificateDeadline } from "./policies";

const OPEN_INBOX = ["received", "analyzed", "ambiguous", "suspected_duplicate"];
const OPEN_DEADLINES = ["planned", "to_process", "postponed", "blocked"];
const ATTESTATION_FIELDS = ["insurer", "policyNumber", "insuredName", "address"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoOrNull(value: string | null | undefined): string | null {
  return value && ISO_DATE.test(value) ? value : null;
}

function emptyExtraction(): ExtractedAttestation {
  return {
    insurer: null,
    policyNumber: null,
    insuredName: null,
    address: null,
    validFrom: null,
    validTo: null,
    coverage: [],
  };
}

function policyLabel(row: { insurerName: string; policyNumber: string }): string {
  return `${row.insurerName} · ${row.policyNumber}`;
}

/**
 * INB-01 / ASS-01: the queue is the inbox items whose extraction reads as an
 * insurance certificate; the proposal says what it matched on and nothing is
 * attached without the owner.
 */
export async function listAttestationCandidates(
  tx: Tx,
  limit: number,
): Promise<{ items: AttestationCandidate[] }> {
  const items = await tx
    .select({
      id: tables.inboxItem.id,
      version: tables.inboxItem.version,
      documentId: tables.inboxItem.documentId,
      activityId: tables.inboxItem.activityId,
      uncertaintyReason: tables.inboxItem.uncertaintyReason,
      createdAt: tables.inboxItem.createdAt,
      subject: tables.activity.subject,
      receivedAt: tables.activity.receivedAt,
    })
    .from(tables.inboxItem)
    .leftJoin(tables.activity, eq(tables.activity.id, tables.inboxItem.activityId))
    .where(
      and(
        inArray(tables.inboxItem.status, OPEN_INBOX),
        sql`EXISTS (
          SELECT 1 FROM ai_extraction e
           WHERE e.inbox_item_id = ${tables.inboxItem.id}
             AND ((e.field_path = 'kind' AND e.proposed_value = 'insurance_attestation')
                   OR e.field_path IN ('policyNumber', 'validTo'))
        )`,
      ),
    )
    .orderBy(desc(tables.inboxItem.createdAt))
    .limit(limit);

  if (items.length === 0) return { items: [] };

  const extractions = await tx
    .select({
      inboxItemId: tables.aiExtraction.inboxItemId,
      fieldPath: tables.aiExtraction.fieldPath,
      proposedValue: tables.aiExtraction.proposedValue,
    })
    .from(tables.aiExtraction)
    .where(
      inArray(
        tables.aiExtraction.inboxItemId,
        items.map((item) => item.id),
      ),
    );

  const byItem = new Map<string, ExtractedAttestation>();
  for (const row of extractions) {
    if (!row.inboxItemId) continue;
    const current = byItem.get(row.inboxItemId) ?? emptyExtraction();
    if (ATTESTATION_FIELDS.includes(row.fieldPath)) {
      (current as Record<string, unknown>)[row.fieldPath] = row.proposedValue;
    } else if (row.fieldPath === "validFrom" || row.fieldPath === "validTo") {
      current[row.fieldPath] = isoOrNull(row.proposedValue);
    } else if (row.fieldPath.startsWith("coverage") && row.proposedValue) {
      current.coverage.push(row.proposedValue);
    }
    byItem.set(row.inboxItemId, current);
  }

  const policies = await tx
    .select({
      id: tables.insurancePolicy.id,
      insurerName: tables.insurancePolicy.insurerName,
      policyNumber: tables.insurancePolicy.policyNumber,
      startsOn: tables.insurancePolicy.startsOn,
      endsOn: tables.insurancePolicy.endsOn,
      legalEntityName: tables.legalEntity.name,
    })
    .from(tables.insurancePolicy)
    .leftJoin(tables.legalEntity, eq(tables.legalEntity.id, tables.insurancePolicy.legalEntityId));

  const candidates: PolicyCandidate[] = policies.map((policy) => ({
    id: policy.id,
    insurerName: policy.insurerName,
    policyNumber: policy.policyNumber,
    insuredName: policy.legalEntityName,
    startsOn: policy.startsOn,
    endsOn: policy.endsOn,
  }));
  const labelById = new Map(policies.map((policy) => [policy.id, policyLabel(policy)]));

  return {
    items: items.map((item) => {
      const extracted = byItem.get(item.id) ?? emptyExtraction();
      const fields: AttestationFields = {
        insurer: extracted.insurer,
        policyNumber: extracted.policyNumber,
        insuredName: extracted.insuredName,
        validFrom: extracted.validFrom,
        validTo: extracted.validTo,
      };
      return {
        inboxItemId: item.id,
        version: item.version,
        receivedAt: new Date(item.receivedAt ?? item.createdAt).toISOString(),
        documentId: item.documentId,
        summary: item.subject,
        uncertaintyReason: item.uncertaintyReason,
        extracted,
        proposals: matchAttestation(fields, candidates).map((match) => ({
          ...match,
          policyLabel: labelById.get(match.policyId) ?? "",
        })),
      };
    }),
  };
}

export async function attachAttestation(
  tx: Tx,
  actor: Actor,
  input: AttachAttestationInput,
): Promise<AttachAttestationResult> {
  const { identity, property, cover, dates } = input.checks;
  if (!identity || !property || !cover || !dates) {
    ruleViolation(
      "L’alerte ne se clôt qu’après contrôle de l’identité, du bien, de la couverture et des dates (ASS-01).",
    );
  }

  const item = firstOr(
    await tx
      .select()
      .from(tables.inboxItem)
      .where(eq(tables.inboxItem.id, input.inboxItemId))
      .limit(1),
    "Élément de l’inbox",
  );
  if (item.version !== input.expectedVersion) versionConflict("L’élément");

  const policy = firstOr(
    await tx
      .select()
      .from(tables.insurancePolicy)
      .where(eq(tables.insurancePolicy.id, input.policyId))
      .limit(1),
    "Police d’assurance",
  );

  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "insurance_policy",
    id: policy.id,
  });

  await tx
    .insert(tables.documentLink)
    .values({
      organizationId: actor.organizationId,
      documentId: input.documentId,
      objectRefId,
      relation: "certificate",
      reason: "Attestation rattachée depuis l’inbox",
    })
    .onConflictDoNothing();

  const now = new Date().toISOString();
  const updated = firstOr(
    await tx
      .update(tables.insurancePolicy)
      .set({
        lastCertificateDocumentId: input.documentId,
        lastCertificateCheckedAt: now,
        ...(input.coverEndsOn === undefined ? {} : { endsOn: input.coverEndsOn }),
        ...(policy.status === "to_verify" || policy.status === "expired"
          ? { status: "active" }
          : {}),
        version: policy.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(tables.insurancePolicy.id, policy.id),
          eq(tables.insurancePolicy.version, policy.version),
        ),
      )
      .returning(),
    "Police d’assurance",
  );

  const { eventId } = await recordFact(tx, actor, {
    kind: "insurance_policy",
    id: policy.id,
    type: "insurance_policy.certificate_checked",
    payload: {
      documentId: input.documentId,
      inboxItemId: input.inboxItemId,
      checks: input.checks,
    },
  });

  // TMP-01: the alert closes against the fact that was recorded, never against
  // the planned date.
  const closed = await tx
    .update(tables.deadline)
    .set({ status: "done", completedEventId: eventId, completedAt: now, updatedAt: now })
    .where(
      and(
        eq(tables.deadline.type, CERTIFICATE_DEADLINE_TYPE),
        inArray(tables.deadline.status, OPEN_DEADLINES),
        inArray(
          tables.deadline.id,
          tx
            .select({ id: tables.deadlineLink.deadlineId })
            .from(tables.deadlineLink)
            .where(eq(tables.deadlineLink.objectRefId, objectRefId)),
        ),
      ),
    )
    .returning({ id: tables.deadline.id });

  const nextDeadlineId = await syncCertificateDeadline(tx, actor, updated);
  const nextDeadline = nextDeadlineId
    ? await tx
        .select({ dueOn: tables.deadline.dueOn })
        .from(tables.deadline)
        .where(eq(tables.deadline.id, nextDeadlineId))
        .limit(1)
    : [];

  if (item.activityId) {
    await linkActivity(tx, {
      organizationId: actor.organizationId,
      activityId: item.activityId,
      objectRefId,
    });
  }

  const inboxUpdated = await tx
    .update(tables.inboxItem)
    .set({
      status: "attached",
      proposedObjectRefId: objectRefId,
      processedAt: now,
      processedBy: actor.actorUserId,
      version: item.version + 1,
      updatedAt: now,
    })
    .where(
      and(eq(tables.inboxItem.id, item.id), eq(tables.inboxItem.version, input.expectedVersion)),
    )
    .returning({ id: tables.inboxItem.id });
  if (!inboxUpdated[0]) versionConflict("L’élément");

  await audit(tx, actor, {
    objectTable: "insurance_policy",
    objectId: policy.id,
    objectRefId,
    action: "certificate.attach",
    before: { lastCertificateDocumentId: policy.lastCertificateDocumentId },
    after: {
      lastCertificateDocumentId: input.documentId,
      inboxItemId: input.inboxItemId,
      closedDeadlines: closed.length,
    },
  });

  return {
    policy: await getPolicy(tx, policy.id),
    closedDeadlineCount: closed.length,
    nextDeadlineOn: nextDeadline[0]?.dueOn ?? null,
  };
}
