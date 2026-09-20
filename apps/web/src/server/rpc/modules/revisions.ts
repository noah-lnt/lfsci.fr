import "server-only";
import { decisionLevelByCommand } from "@lfsci/contracts";
import { createCommand, ensureObjectRef, hashPayload, type Tx, tables } from "@lfsci/db";
import {
  type DpeClass,
  proposeRevision,
  type RevisionProposal,
  type Territory,
} from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import {
  type IndexValueRead,
  LetterResult,
  type PrepareRevisionInput,
  PrepareRevisionResult,
  RevisionScreen,
} from "@/lib/contracts/revisions";
import { tenant } from "../../data";
import { audit, recordFact } from "../../finance/facts";
import { amount, firstOr, instant, today, versionConflict } from "../../finance/shared";
import { enqueueJob } from "../../queue";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

const OPERATION_NAMESPACE = "6f1c2b2e-2c7f-4c4a-9c4f-2f4a1b7d9e10";
const IRL_RULE_CODE = "irl_index";
const SERIES_SOURCE = "INSEE, série des indices de référence des loyers";

type Scoped = RpcContext & { organizationId: string };
type Actor = { organizationId: string; actorUserId: string | null };
type LeaseRow = typeof tables.lease.$inferSelect;

function actorOf(context: Scoped): Actor {
  return { organizationId: context.organizationId, actorUserId: context.session?.user.id ?? null };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

function operationKey(command: string, objectId: string): string {
  return uuidv5(`${command}:${objectId}`, OPERATION_NAMESPACE);
}

function parseQuarter(value: string | null): { year: number; quarter: 1 | 2 | 3 | 4 } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(value ?? "");
  const year = match?.[1];
  const quarter = match?.[2];
  if (!year || !quarter) return null;
  return { year: Number(year), quarter: Number(quarter) as 1 | 2 | 3 | 4 };
}

type Observation = { year: number; quarter: number; value: number };

async function series(tx: Tx): Promise<{ observations: Observation[]; updatedAt: string | null }> {
  const rows = await tx
    .select({
      definition: tables.ruleVersion.definition,
      createdAt: tables.ruleVersion.createdAt,
    })
    .from(tables.ruleVersion)
    .innerJoin(tables.rule, eq(tables.ruleVersion.ruleId, tables.rule.id))
    .where(and(eq(tables.rule.code, IRL_RULE_CODE), eq(tables.ruleVersion.status, "active")))
    .limit(1);
  const row = rows[0];
  const definition = row?.definition as { observations?: Observation[] } | undefined;
  return {
    observations: definition?.observations ?? [],
    updatedAt: instant(row?.createdAt),
  };
}

/** The overseas départements keep their own rent rules; the postal code is what we hold. */
export function territoryOf(postalCode: string | null): Territory {
  if (!postalCode) return "metropole";
  return postalCode.startsWith("97") || postalCode.startsWith("98") ? "outre_mer" : "metropole";
}

export function revisionDueDate(lease: LeaseRow, requestDate: string): string {
  const month = lease.revisionMonth ?? Number((lease.startsOn ?? requestDate).slice(5, 7));
  return `${requestDate.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
}

type LeaseContext = {
  lease: LeaseRow;
  energyClass: DpeClass | null;
  territory: Territory;
  unitLabel: string | null;
  observations: Observation[];
  seriesUpdatedAt: string | null;
};

async function leaseContext(tx: Tx, leaseId: string): Promise<LeaseContext> {
  const lease = firstOr(
    await tx.select().from(tables.lease).where(eq(tables.lease.id, leaseId)).limit(1),
    "Bail",
  );
  const units = await tx
    .select({
      energyClass: tables.unit.energyClass,
      code: tables.unit.code,
      label: tables.unit.label,
      postalCode: tables.building.postalCode,
    })
    .from(tables.leaseUnit)
    .innerJoin(tables.unit, eq(tables.leaseUnit.unitId, tables.unit.id))
    .innerJoin(tables.building, eq(tables.unit.buildingId, tables.building.id))
    .where(and(eq(tables.leaseUnit.leaseId, leaseId), eq(tables.leaseUnit.role, "main")))
    .limit(1);
  const unit = units[0];
  const { observations, updatedAt } = await series(tx);
  return {
    lease,
    energyClass: (unit?.energyClass as DpeClass | undefined) ?? null,
    territory: territoryOf(unit?.postalCode ?? null),
    unitLabel: unit ? `${unit.code} — ${unit.label}` : null,
    observations,
    seriesUpdatedAt: updatedAt,
  };
}

function indexRead(observation: Observation): IndexValueRead {
  return {
    value: observation.value.toFixed(2),
    quarter: observation.quarter,
    year: observation.year,
    period: `${observation.year}-T${observation.quarter}`,
  };
}

/** IRL-01: every input comes from the lease and the stored series; nothing is guessed. */
function buildProposal(context: LeaseContext, requestDate: string): RevisionProposal {
  const { lease } = context;
  const reference = parseQuarter(lease.revisionReferenceQuarter);
  const base = reference
    ? context.observations.find(
        (entry) => entry.year === reference.year && entry.quarter === reference.quarter,
      )
    : undefined;
  const latest = reference
    ? context.observations
        .filter((entry) => entry.quarter === reference.quarter && entry.year > reference.year)
        .sort((a, b) => b.year - a.year)[0]
    : undefined;

  return proposeRevision({
    currentRent: amount(lease.rentExclCharges),
    clausePresent: lease.revisionIndex !== null && lease.revisionIndex !== "none",
    ...(base && reference
      ? { baseIndex: { value: base.value.toFixed(2), quarter: reference.quarter, year: base.year } }
      : {}),
    ...(latest && reference
      ? {
          newIndex: {
            value: latest.value.toFixed(2),
            quarter: reference.quarter,
            year: latest.year,
          },
        }
      : {}),
    ...(context.energyClass ? { dpeClass: context.energyClass } : {}),
    territory: context.territory,
    requestDate,
    revisionDueDate: revisionDueDate(lease, requestDate),
  });
}

async function readScreen(tx: Tx, leaseId: string, requestDate: string): Promise<RevisionScreen> {
  const context = await leaseContext(tx, leaseId);
  const proposal = buildProposal(context, requestDate);
  const { lease } = context;

  const revisions = await tx
    .select()
    .from(tables.rentRevision)
    .where(eq(tables.rentRevision.leaseId, leaseId))
    .orderBy(desc(tables.rentRevision.createdAt));
  const commands =
    revisions.length === 0
      ? []
      : await tx
          .select({
            id: tables.command.id,
            status: tables.command.status,
            operationKey: tables.command.operationKey,
          })
          .from(tables.command)
          .where(
            inArray(
              tables.command.operationKey,
              revisions.map((revision) => operationKey("revise_rent", revision.id)),
            ),
          );
  const documents = await tx
    .select({ id: tables.document.id, title: tables.document.title })
    .from(tables.document)
    .where(eq(tables.document.nature, "rent_revision_letter"))
    .orderBy(asc(tables.document.createdAt));

  const month = lease.revisionMonth;
  const nextRevisionOn = month
    ? `${requestDate.slice(0, 4)}-${String(month).padStart(2, "0")}-01`
    : null;

  return RevisionScreen.parse({
    context: {
      leaseId: lease.id,
      leaseReference: lease.reference,
      leaseVersion: lease.version,
      currency: lease.currency,
      indexName: lease.revisionIndex === "none" ? null : lease.revisionIndex,
      referenceQuarter: lease.revisionReferenceQuarter,
      revisionMonth: month,
      nextRevisionOn,
      energyClass: context.energyClass,
      territory: context.territory,
      unitLabel: context.unitLabel,
      chargeAmount: lease.chargeAmount === null ? null : amount(lease.chargeAmount),
      seriesUpdatedAt: context.seriesUpdatedAt,
      seriesSource: context.observations.length > 0 ? SERIES_SOURCE : null,
      observations: context.observations
        .slice()
        .sort((a, b) => b.year - a.year || b.quarter - a.quarter)
        .map(indexRead),
    },
    proposal: proposal.ok
      ? {
          available: true,
          blockedReason: null,
          missing: [],
          currentRent: proposal.currentRent,
          newRent: proposal.newRent,
          newRentUnrounded: proposal.newRentUnrounded,
          increase: proposal.increase,
          baseIndex: {
            ...proposal.baseIndex,
            period: `${proposal.baseIndex.year}-T${proposal.baseIndex.quarter}`,
          },
          newIndex: {
            ...proposal.newIndex,
            period: `${proposal.newIndex.year}-T${proposal.newIndex.quarter}`,
          },
          effectiveFrom: proposal.effectiveFrom,
          retroactive: false,
        }
      : {
          available: false,
          blockedReason: proposal.reason,
          missing: proposal.missing ?? [],
          currentRent: lease.rentExclCharges === null ? null : amount(lease.rentExclCharges),
          newRent: null,
          newRentUnrounded: null,
          increase: null,
          baseIndex: null,
          newIndex: null,
          effectiveFrom: null,
          retroactive: false,
        },
    history: revisions.map((revision) => {
      const command = commands.find(
        (entry) => entry.operationKey === operationKey("revise_rent", revision.id),
      );
      const letter = documents.find((document) => document.title.includes(revision.id));
      return {
        id: revision.id,
        indexName: revision.indexName,
        referenceQuarter: revision.referenceQuarter,
        previousIndexValue: revision.previousIndexValue,
        newIndexValue: revision.newIndexValue,
        baseRent: amount(revision.baseRent),
        proposedRent: amount(revision.proposedRent),
        computedRentUnrounded: revision.computedRentUnrounded,
        currency: revision.currency,
        requestedOn: revision.requestedOn,
        effectiveOn: revision.effectiveOn,
        status: revision.status,
        blockingReason: revision.blockingReason,
        commandId: command?.id ?? null,
        commandStatus: command?.status ?? null,
        letterDocumentId: letter?.id ?? null,
        createdAt: instant(revision.createdAt) ?? new Date().toISOString(),
      };
    }),
  });
}

/** IRL-01 / §17.1: a revision is a level-D decision; the command stays prepared. */
async function prepare(
  tx: Tx,
  actor: Actor,
  input: PrepareRevisionInput,
): Promise<PrepareRevisionResult> {
  const requestDate = input.requestDate ?? today();
  const context = await leaseContext(tx, input.leaseId);
  const { lease } = context;
  if (lease.version !== input.expectedVersion) versionConflict("Le bail");

  const proposal = buildProposal(context, requestDate);
  if (!proposal.ok) {
    throw new AppError("RULE_VIOLATION", {
      message: "La révision est bloquée ; complétez les éléments manquants.",
      details: { reason: proposal.reason, missing: proposal.missing ?? [] },
    });
  }

  const revision = firstOr(
    await tx
      .insert(tables.rentRevision)
      .values({
        organizationId: actor.organizationId,
        leaseId: lease.id,
        indexName: lease.revisionIndex ?? "irl",
        referenceQuarter: lease.revisionReferenceQuarter ?? "",
        previousIndexValue: proposal.baseIndex.value,
        newIndexValue: proposal.newIndex.value,
        baseRent: proposal.currentRent,
        computedRentUnrounded: proposal.newRentUnrounded,
        proposedRent: proposal.newRent,
        currency: lease.currency,
        requestedOn: requestDate,
        effectiveOn: proposal.effectiveFrom,
        status: "proposed",
      })
      .returning(),
    "Révision",
  );

  const payload = {
    leaseId: lease.id,
    rentRevisionId: revision.id,
    indexName: revision.indexName as "irl",
    referenceQuarter: revision.referenceQuarter,
    previousIndexValue: revision.previousIndexValue,
    newIndexValue: revision.newIndexValue,
    baseRent: proposal.currentRent,
    proposedRent: proposal.newRent,
    currency: lease.currency,
    effectiveOn: proposal.effectiveFrom,
  };
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "lease",
    id: lease.id,
  });
  const command = await createCommand(tx, {
    organizationId: actor.organizationId,
    commandType: "revise_rent",
    operationKey: operationKey("revise_rent", revision.id),
    payload,
    payloadHash: hashPayload(payload),
    targetObjectRefId: objectRefId,
    expectedVersion: lease.version,
    actorUserId: actor.actorUserId,
    autonomyLevel: decisionLevelByCommand.revise_rent,
    status: "prepared",
  });

  await recordFact(tx, actor, {
    kind: "lease",
    id: lease.id,
    type: "revision.proposed",
    payload: { revisionId: revision.id, proposedRent: proposal.newRent },
  });
  await audit(tx, actor, {
    objectTable: "rent_revision",
    objectId: revision.id,
    objectRefId,
    action: "propose",
    after: payload,
  });

  return {
    screen: await readScreen(tx, lease.id, requestDate),
    revisionId: revision.id,
    commandId: command.id,
    commandStatus: command.status,
    decisionLevel: decisionLevelByCommand.revise_rent,
  };
}

/** IRL-01: the tenant is notified with the exact index values that were used. */
async function letter(tx: Tx, actor: Actor, revisionId: string): Promise<LetterResult> {
  const revision = firstOr(
    await tx
      .select()
      .from(tables.rentRevision)
      .where(eq(tables.rentRevision.id, revisionId))
      .limit(1),
    "Révision",
  );
  const lease = firstOr(
    await tx.select().from(tables.lease).where(eq(tables.lease.id, revision.leaseId)).limit(1),
    "Bail",
  );

  const document = firstOr(
    await tx
      .insert(tables.document)
      .values({
        organizationId: actor.organizationId,
        title: `Révision de loyer ${lease.reference} — ${revision.id}`,
        nature: "rent_revision_letter",
        confidentiality: "public_to_tenant",
        status: "uploading",
      })
      .returning(),
    "Document",
  );
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "lease",
    id: lease.id,
  });
  await tx
    .insert(tables.documentLink)
    .values({
      organizationId: actor.organizationId,
      documentId: document.id,
      objectRefId,
      relation: "report",
    })
    .onConflictDoNothing();

  const jobId = await enqueueJob("pdf.render", {
    organizationId: actor.organizationId,
    template: "revision",
    documentId: document.id,
    rentRevisionId: revision.id,
  });

  await audit(tx, actor, {
    objectTable: "rent_revision",
    objectId: revision.id,
    objectRefId,
    action: "letter",
    after: { documentId: document.id },
  });

  return {
    documentId: document.id,
    jobId,
    screen: await readScreen(tx, lease.id, today()),
  };
}

export const revisionsRouter = {
  revisions: {
    get: withOrganization.revisions.get
      .use(validated(RevisionScreen))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => readScreen(tx, input.leaseId, input.requestDate ?? today())),
      ),
    prepare: withOrganization.revisions.prepare
      .use(validated(PrepareRevisionResult))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => prepare(tx, actorOf(context), input)),
      ),
    letter: withOrganization.revisions.letter
      .use(validated(LetterResult))
      .handler(({ context, input }) =>
        tenant(scope(context), (tx) => letter(tx, actorOf(context), input.revisionId)),
      ),
  },
};
