import "server-only";
import type { Inspection, InspectionFinding, InventoryItem } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AddFindingInput,
  AddInventoryItemInput,
  ComparisonRead,
  CreateInspectionInput,
  DepositSettlementRead,
  InspectionDetail,
  InspectionPhoto,
  InspectionRow,
  SettlementDeduction,
  UpdateFindingInput,
  UpdateInspectionInput,
  UpdateInventoryItemInput,
} from "@/lib/contracts/inspections";
import { type Actor, audit, planDeadline, recordFact } from "../finance/facts";
import {
  addDays,
  amountOrNull,
  DEFAULT_LIMIT,
  firstOr,
  instant,
  instantOrNow,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  versionConflict,
} from "../finance/shared";
import { depositFor } from "../locations/queries";
import {
  compareFindings,
  compareInventory,
  exitConforms,
  prepareSettlement,
  type SettlementCandidate,
} from "./comparison";

type InspectionRowIn = typeof tables.inspection.$inferSelect;
type FindingRowIn = typeof tables.inspectionFinding.$inferSelect;
type InventoryRowIn = typeof tables.inventoryItem.$inferSelect;

/** EDL-01: the ten calendar days a complement request has, from the visit. */
const COMPLEMENT_DAYS = 10;

/** Statuses past which a row is evidence, not a draft. */
const SEALED = ["signed", "contested", "archived"];

/** EDL-03: what the owner may attach as proof of a repair. */
const JUSTIFICATION_RELATIONS = ["invoice", "evidence", "report"];

function audited(row: { createdAt: string; updatedAt: string | null; version: number }) {
  return {
    createdAt: instantOrNow(row.createdAt),
    updatedAt: instant(row.updatedAt),
    version: row.version,
  };
}

function mapInspection(row: InspectionRowIn): Inspection {
  return {
    id: row.id,
    ...audited(row),
    leaseId: row.leaseId,
    unitId: row.unitId,
    kind: row.kind as Inspection["kind"],
    performedOn: row.performedOn,
    status: row.status as Inspection["status"],
    signedDocumentId: row.signedDocumentId,
    signatureEvidence: row.signatureEvidence,
    keysHandedOverOn: row.keysHandedOverOn,
    complementDeadlineOn: row.complementDeadlineOn,
    heatingComplementDeadlineOn: row.heatingComplementDeadlineOn,
    offlineCapture: row.offlineCapture,
  };
}

function mapFinding(row: FindingRowIn): InspectionFinding {
  return {
    id: row.id,
    ...audited(row),
    inspectionId: row.inspectionId,
    room: row.room,
    element: row.element,
    equipmentId: row.equipmentId,
    condition: row.condition as InspectionFinding["condition"],
    description: row.description,
    entryFindingId: row.entryFindingId,
    isNewVersusEntry: row.isNewVersusEntry,
    proposedWearShare: row.proposedWearShare,
    decidedAmount: amountOrNull(row.decidedAmount),
    currency: row.currency,
    decisionApprovalId: row.decisionApprovalId,
  };
}

function mapInventoryItem(row: InventoryRowIn): InventoryItem {
  return {
    id: row.id,
    ...audited(row),
    unitId: row.unitId,
    leaseId: row.leaseId,
    category: row.category,
    label: row.label,
    quantity: row.quantity,
    condition: row.condition as InventoryItem["condition"],
    purchaseValue: amountOrNull(row.purchaseValue),
    currency: row.currency,
    equipmentId: row.equipmentId,
    presentAtEntry: row.presentAtEntry,
    presentAtExit: row.presentAtExit,
  };
}

async function inspectionRow(tx: Tx, id: string): Promise<InspectionRowIn> {
  return firstOr(
    await tx.select().from(tables.inspection).where(eq(tables.inspection.id, id)).limit(1),
    "État des lieux",
  );
}

function refuseIfSealed(row: InspectionRowIn): void {
  if (SEALED.includes(row.status)) {
    ruleViolation(
      "Un état des lieux signé ne se supprime pas ; enregistrez un complément ou un avenant.",
      { status: row.status },
    );
  }
}

/**
 * A registry row or a meter reading points at this inspection through a foreign
 * key: deleting it would either fail opaquely or orphan an attachment, so the
 * refusal is explicit.
 */
async function refuseIfReferenced(tx: Tx, id: string): Promise<void> {
  const [refs, readings] = await Promise.all([
    tx
      .select({ id: tables.objectRef.id })
      .from(tables.objectRef)
      .where(eq(tables.objectRef.inspectionId, id))
      .limit(1),
    tx
      .select({ id: tables.meterReading.id })
      .from(tables.meterReading)
      .where(eq(tables.meterReading.inspectionId, id))
      .limit(1),
  ]);
  if (refs.length > 0 || readings.length > 0) {
    ruleViolation(
      "Cette visite porte déjà des pièces, un relevé ou un historique : elle ne peut plus être supprimée.",
    );
  }
}

async function findingCounts(tx: Tx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      inspectionId: tables.inspectionFinding.inspectionId,
      count: sql<number>`count(*)::int`,
    })
    .from(tables.inspectionFinding)
    .where(inArray(tables.inspectionFinding.inspectionId, [...ids]))
    .groupBy(tables.inspectionFinding.inspectionId);
  return new Map(rows.map((row) => [row.inspectionId, row.count]));
}

async function photoCounts(tx: Tx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      inspectionId: tables.objectRef.inspectionId,
      count: sql<number>`count(distinct ${tables.documentLink.documentId})::int`,
    })
    .from(tables.documentLink)
    .innerJoin(tables.objectRef, eq(tables.objectRef.id, tables.documentLink.objectRefId))
    .where(inArray(tables.objectRef.inspectionId, [...ids]))
    .groupBy(tables.objectRef.inspectionId);
  return new Map(
    rows.flatMap((row) => (row.inspectionId ? [[row.inspectionId, row.count] as const] : [])),
  );
}

/** EDL-01: author, capture instant, reception instant and the missing-metadata flag. */
async function photosOf(tx: Tx, inspectionId: string): Promise<InspectionPhoto[]> {
  const rows = await tx
    .select({
      documentId: tables.document.id,
      title: tables.document.title,
      authorName: tables.appUser.fullName,
      capturedAt: tables.documentVersion.capturedAt,
      receivedAt: tables.documentVersion.receivedAt,
      metadataMissing: tables.documentVersion.metadataMissing,
      sha256: tables.documentVersion.sha256,
      relation: tables.documentLink.relation,
    })
    .from(tables.documentLink)
    .innerJoin(tables.objectRef, eq(tables.objectRef.id, tables.documentLink.objectRefId))
    .innerJoin(tables.document, eq(tables.document.id, tables.documentLink.documentId))
    .innerJoin(
      tables.documentVersion,
      eq(tables.documentVersion.id, tables.document.currentVersionId),
    )
    .leftJoin(tables.appUser, eq(tables.appUser.id, tables.document.authorUserId))
    .where(eq(tables.objectRef.inspectionId, inspectionId))
    .orderBy(desc(tables.documentVersion.receivedAt));

  // A document linked twice (attached, then invoice) is one row carrying both.
  const byDocument = new Map<string, InspectionPhoto>();
  for (const row of rows) {
    const relation = row.relation as InspectionPhoto["relations"][number];
    const existing = byDocument.get(row.documentId);
    if (existing) {
      existing.relations.push(relation);
      continue;
    }
    byDocument.set(row.documentId, {
      documentId: row.documentId,
      title: row.title,
      authorName: row.authorName,
      capturedAt: instant(row.capturedAt),
      receivedAt: instantOrNow(row.receivedAt),
      metadataMissing: row.metadataMissing,
      sha256: row.sha256,
      relations: [relation],
    });
  }
  return [...byDocument.values()];
}

export async function listInspections(
  tx: Tx,
  input: {
    leaseId: string;
    kind?: string | undefined;
    cursor?: string | undefined;
    limit?: number;
  },
): Promise<{ items: InspectionRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    eq(tables.inspection.leaseId, input.leaseId),
    input.kind ? eq(tables.inspection.kind, input.kind) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select({ inspection: tables.inspection, unitLabel: tables.unit.label })
    .from(tables.inspection)
    .innerJoin(tables.unit, eq(tables.unit.id, tables.inspection.unitId))
    .where(and(...filters))
    .orderBy(desc(tables.inspection.performedOn), desc(tables.inspection.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.inspection.id);
  const [findings, photos] = await Promise.all([findingCounts(tx, ids), photoCounts(tx, ids)]);

  return {
    items: page.map((row) => ({
      ...mapInspection(row.inspection),
      unitLabel: row.unitLabel,
      findingCount: findings.get(row.inspection.id) ?? 0,
      photoCount: photos.get(row.inspection.id) ?? 0,
    })),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getInspection(tx: Tx, id: string): Promise<InspectionDetail> {
  const row = await inspectionRow(tx, id);
  const [unit, lease, findings, photos] = await Promise.all([
    tx.select({ label: tables.unit.label }).from(tables.unit).where(eq(tables.unit.id, row.unitId)),
    tx
      .select({ reference: tables.lease.reference })
      .from(tables.lease)
      .where(eq(tables.lease.id, row.leaseId)),
    tx
      .select()
      .from(tables.inspectionFinding)
      .where(eq(tables.inspectionFinding.inspectionId, id))
      .orderBy(asc(tables.inspectionFinding.room), asc(tables.inspectionFinding.createdAt)),
    photosOf(tx, id),
  ]);

  return {
    ...mapInspection(row),
    unitLabel: unit[0]?.label ?? "—",
    leaseReference: lease[0]?.reference ?? "—",
    findings: findings.map(mapFinding),
    photos,
  };
}

export async function createInspection(
  tx: Tx,
  actor: Actor,
  input: CreateInspectionInput,
): Promise<Inspection> {
  const attached = await tx
    .select({ id: tables.leaseUnit.id })
    .from(tables.leaseUnit)
    .where(
      and(eq(tables.leaseUnit.leaseId, input.leaseId), eq(tables.leaseUnit.unitId, input.unitId)),
    )
    .limit(1);
  if (attached.length === 0) ruleViolation("Ce lot n’est pas rattaché au bail.");

  const row = firstOr(
    await tx
      .insert(tables.inspection)
      .values({
        organizationId: actor.organizationId,
        leaseId: input.leaseId,
        unitId: input.unitId,
        kind: input.kind,
        performedOn: input.performedOn ?? null,
        status: "draft",
        offlineCapture: input.offlineCapture ?? false,
        complementDeadlineOn: complementDeadline(input.kind, input.performedOn ?? null),
      })
      .returning(),
    "État des lieux",
  );
  // No object_ref yet: the registry row is what a draft with nothing attached
  // to it can still be deleted without leaving a dangling reference. It is
  // created on signature, together with the timeline fact.
  await audit(tx, actor, {
    objectTable: "inspection",
    objectId: row.id,
    action: "create",
    after: { kind: row.kind, performedOn: row.performedOn },
  });
  return mapInspection(row);
}

/** EDL-01: only the entry inspection opens the ten-day complement window. */
function complementDeadline(kind: string, performedOn: string | null): string | null {
  return kind === "entry" && performedOn !== null ? addDays(performedOn, COMPLEMENT_DAYS) : null;
}

export async function updateInspection(
  tx: Tx,
  actor: Actor,
  input: UpdateInspectionInput,
): Promise<Inspection> {
  const current = await inspectionRow(tx, input.id);
  const performedOn = input.performedOn === undefined ? current.performedOn : input.performedOn;
  const patch = {
    ...(input.performedOn === undefined ? {} : { performedOn: input.performedOn }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.keysHandedOverOn === undefined ? {} : { keysHandedOverOn: input.keysHandedOverOn }),
    ...(input.heatingComplementDeadlineOn === undefined
      ? {}
      : { heatingComplementDeadlineOn: input.heatingComplementDeadlineOn }),
    ...(input.signedDocumentId === undefined ? {} : { signedDocumentId: input.signedDocumentId }),
    ...(input.signatureEvidence === undefined
      ? {}
      : { signatureEvidence: input.signatureEvidence }),
    complementDeadlineOn: complementDeadline(current.kind, performedOn),
  };

  const updated = await tx
    .update(tables.inspection)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(eq(tables.inspection.id, input.id), eq(tables.inspection.version, input.expectedVersion)),
    )
    .returning();
  const row = updated[0];
  if (!row) versionConflict("L’état des lieux");

  const becameSigned = input.status === "signed" && current.status !== "signed";
  if (becameSigned) {
    const { objectRefId } = await recordFact(tx, actor, {
      kind: "inspection",
      id: row.id,
      type: "inspection.signed",
    });
    // EDL-01: the complement window is a deadline, never an edit of the signed document.
    if (row.complementDeadlineOn) {
      await planDeadline(tx, actor, {
        type: "inspection_complement",
        title: "Demande de complément de l’état des lieux d’entrée",
        dueOn: row.complementDeadlineOn,
        objectRefId,
      });
    }
    if (row.heatingComplementDeadlineOn) {
      await planDeadline(tx, actor, {
        type: "inspection_heating_complement",
        title: "Complément chauffage de l’état des lieux",
        dueOn: row.heatingComplementDeadlineOn,
        objectRefId,
      });
    }
  }

  await audit(tx, actor, {
    objectTable: "inspection",
    objectId: input.id,
    action: "update",
    before: { status: current.status },
    after: patch,
  });
  return mapInspection(row);
}

export async function removeInspection(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number },
): Promise<{ id: string }> {
  const current = await inspectionRow(tx, input.id);
  refuseIfSealed(current);
  await refuseIfReferenced(tx, input.id);
  await tx
    .delete(tables.inspectionFinding)
    .where(eq(tables.inspectionFinding.inspectionId, input.id));
  const deleted = await tx
    .delete(tables.inspection)
    .where(
      and(eq(tables.inspection.id, input.id), eq(tables.inspection.version, input.expectedVersion)),
    )
    .returning({ id: tables.inspection.id });
  if (!deleted[0]) versionConflict("L’état des lieux");
  await audit(tx, actor, {
    objectTable: "inspection",
    objectId: input.id,
    action: "delete",
    before: { kind: current.kind, status: current.status },
  });
  return { id: input.id };
}

export async function addFinding(
  tx: Tx,
  actor: Actor,
  input: AddFindingInput,
): Promise<InspectionFinding> {
  await inspectionRow(tx, input.inspectionId);
  const row = firstOr(
    await tx
      .insert(tables.inspectionFinding)
      .values({
        organizationId: actor.organizationId,
        inspectionId: input.inspectionId,
        room: input.room ?? null,
        element: input.element,
        condition: input.condition ?? null,
        description: input.description ?? null,
        equipmentId: input.equipmentId ?? null,
      })
      .returning(),
    "Constat",
  );
  await audit(tx, actor, {
    objectTable: "inspection_finding",
    objectId: row.id,
    action: "create",
    after: { room: row.room, element: row.element, condition: row.condition },
  });
  return mapFinding(row);
}

export async function updateFinding(
  tx: Tx,
  actor: Actor,
  input: UpdateFindingInput,
): Promise<InspectionFinding> {
  const patch = {
    ...(input.room === undefined ? {} : { room: input.room }),
    ...(input.element === undefined ? {} : { element: input.element }),
    ...(input.condition === undefined ? {} : { condition: input.condition }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.proposedWearShare === undefined
      ? {}
      : { proposedWearShare: input.proposedWearShare }),
    ...(input.decidedAmount === undefined ? {} : { decidedAmount: input.decidedAmount }),
  };
  const updated = await tx
    .update(tables.inspectionFinding)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.inspectionFinding.id, input.id),
        eq(tables.inspectionFinding.version, input.expectedVersion),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) versionConflict("Le constat");
  await audit(tx, actor, {
    objectTable: "inspection_finding",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return mapFinding(row);
}

export async function removeFinding(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number },
): Promise<{ id: string }> {
  const findings = await tx
    .select()
    .from(tables.inspectionFinding)
    .where(eq(tables.inspectionFinding.id, input.id))
    .limit(1);
  const finding = firstOr(findings, "Constat");
  refuseIfSealed(await inspectionRow(tx, finding.inspectionId));
  const deleted = await tx
    .delete(tables.inspectionFinding)
    .where(
      and(
        eq(tables.inspectionFinding.id, input.id),
        eq(tables.inspectionFinding.version, input.expectedVersion),
      ),
    )
    .returning({ id: tables.inspectionFinding.id });
  if (!deleted[0]) versionConflict("Le constat");
  await audit(tx, actor, {
    objectTable: "inspection_finding",
    objectId: input.id,
    action: "delete",
    before: { element: finding.element },
  });
  return { id: input.id };
}

export async function listInventory(
  tx: Tx,
  input: { leaseId: string; cursor?: string | undefined; limit?: number },
): Promise<{ items: InventoryItem[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const rows = await tx
    .select()
    .from(tables.inventoryItem)
    .where(eq(tables.inventoryItem.leaseId, input.leaseId))
    .orderBy(asc(tables.inventoryItem.category), asc(tables.inventoryItem.label))
    .limit(limit + 1)
    .offset(offset);
  return {
    items: rows.slice(0, limit).map(mapInventoryItem),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function addInventoryItem(
  tx: Tx,
  actor: Actor,
  input: AddInventoryItemInput,
): Promise<InventoryItem> {
  const row = firstOr(
    await tx
      .insert(tables.inventoryItem)
      .values({
        organizationId: actor.organizationId,
        leaseId: input.leaseId,
        unitId: input.unitId,
        category: input.category,
        label: input.label,
        quantity: input.quantity ?? "1",
        condition: input.condition ?? null,
        purchaseValue: input.purchaseValue ?? null,
        equipmentId: input.equipmentId ?? null,
        presentAtEntry: input.presentAtEntry ?? null,
        presentAtExit: input.presentAtExit ?? null,
      })
      .returning(),
    "Ligne d’inventaire",
  );
  await audit(tx, actor, {
    objectTable: "inventory_item",
    objectId: row.id,
    action: "create",
    after: { label: row.label, quantity: row.quantity },
  });
  return mapInventoryItem(row);
}

export async function updateInventoryItem(
  tx: Tx,
  actor: Actor,
  input: UpdateInventoryItemInput,
): Promise<InventoryItem> {
  const patch = {
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
    ...(input.condition === undefined ? {} : { condition: input.condition }),
    ...(input.purchaseValue === undefined ? {} : { purchaseValue: input.purchaseValue }),
    ...(input.presentAtEntry === undefined ? {} : { presentAtEntry: input.presentAtEntry }),
    ...(input.presentAtExit === undefined ? {} : { presentAtExit: input.presentAtExit }),
  };
  const updated = await tx
    .update(tables.inventoryItem)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.inventoryItem.id, input.id),
        eq(tables.inventoryItem.version, input.expectedVersion),
      ),
    )
    .returning();
  const row = updated[0];
  if (!row) versionConflict("La ligne d’inventaire");
  await audit(tx, actor, {
    objectTable: "inventory_item",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return mapInventoryItem(row);
}

export async function removeInventoryItem(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number },
): Promise<{ id: string }> {
  const deleted = await tx
    .delete(tables.inventoryItem)
    .where(
      and(
        eq(tables.inventoryItem.id, input.id),
        eq(tables.inventoryItem.version, input.expectedVersion),
      ),
    )
    .returning({ id: tables.inventoryItem.id, label: tables.inventoryItem.label });
  const row = deleted[0];
  if (!row) versionConflict("La ligne d’inventaire");
  await audit(tx, actor, {
    objectTable: "inventory_item",
    objectId: input.id,
    action: "delete",
    before: { label: row.label },
  });
  return { id: input.id };
}

type Sides = {
  entry: InspectionRowIn | undefined;
  exit: InspectionRowIn | undefined;
};

/** The latest signed-or-not visit of each kind is the one compared. */
async function sidesOf(tx: Tx, leaseId: string): Promise<Sides> {
  const rows = await tx
    .select()
    .from(tables.inspection)
    .where(eq(tables.inspection.leaseId, leaseId))
    .orderBy(desc(tables.inspection.performedOn), desc(tables.inspection.createdAt));
  return {
    entry: rows.find((row) => row.kind === "entry"),
    exit: rows.find((row) => row.kind === "exit"),
  };
}

async function findingsOf(tx: Tx, inspectionId: string | undefined): Promise<FindingRowIn[]> {
  if (!inspectionId) return [];
  return tx
    .select()
    .from(tables.inspectionFinding)
    .where(eq(tables.inspectionFinding.inspectionId, inspectionId));
}

export async function comparisonFor(tx: Tx, leaseId: string): Promise<ComparisonRead> {
  const sides = await sidesOf(tx, leaseId);
  const [entryFindings, exitFindings, inventoryRows] = await Promise.all([
    findingsOf(tx, sides.entry?.id),
    findingsOf(tx, sides.exit?.id),
    tx.select().from(tables.inventoryItem).where(eq(tables.inventoryItem.leaseId, leaseId)),
  ]);

  const toComparable = (row: FindingRowIn) => ({
    id: row.id,
    room: row.room,
    element: row.element,
    condition: row.condition as InspectionFinding["condition"],
    description: row.description,
  });

  const differences = compareFindings(
    entryFindings.map(toComparable),
    exitFindings.map(toComparable),
  );
  const inventory = compareInventory(
    inventoryRows.map((row) => ({
      id: row.id,
      label: row.label,
      category: row.category,
      quantity: row.quantity,
      condition: row.condition as InventoryItem["condition"],
      presentAtEntry: row.presentAtEntry,
      presentAtExit: row.presentAtExit,
    })),
  );

  return {
    leaseId,
    entryInspectionId: sides.entry?.id ?? null,
    exitInspectionId: sides.exit?.id ?? null,
    differences,
    inventory,
    proposedCount: differences.filter((difference) => difference.proposedForReview).length,
    exitConforms: exitConforms(differences, inventory),
  };
}

/** EDL-03: proof of repair attached to the exit visit, not to a finding. */
async function justificationIdsOf(tx: Tx, inspectionId: string | undefined): Promise<string[]> {
  if (!inspectionId) return [];
  const rows = await tx
    .select({ documentId: tables.documentLink.documentId })
    .from(tables.documentLink)
    .innerJoin(tables.objectRef, eq(tables.objectRef.id, tables.documentLink.objectRefId))
    .where(
      and(
        eq(tables.objectRef.inspectionId, inspectionId),
        inArray(tables.documentLink.relation, JUSTIFICATION_RELATIONS),
      ),
    );
  return [...new Set(rows.map((row) => row.documentId))];
}

export async function settlementFor(tx: Tx, leaseId: string): Promise<DepositSettlementRead> {
  const [comparison, sides, deposit, leases] = await Promise.all([
    comparisonFor(tx, leaseId),
    sidesOf(tx, leaseId),
    depositFor(tx, leaseId),
    tx
      .select({ kind: tables.lease.kind, depositAmount: tables.lease.depositAmount })
      .from(tables.lease)
      .where(eq(tables.lease.id, leaseId))
      .limit(1),
  ]);
  const lease = firstOr(leases, "Bail");
  const justificationIds = await justificationIdsOf(tx, sides.exit?.id);
  const exitFindings = await findingsOf(tx, sides.exit?.id);

  // EDL-02/EDL-03: only an amount the owner decided is a candidate deduction.
  // A missing inventory item is reported beside it and withholds nothing.
  const deductions: SettlementDeduction[] = exitFindings
    .filter((row) => row.decidedAmount !== null)
    .map((row) => ({
      findingId: row.id,
      label: row.room ? `${row.room} — ${row.element}` : row.element,
      amount: amountOrNull(row.decidedAmount) ?? "0.00",
      justificationCount: justificationIds.length,
    }));

  const candidates: SettlementCandidate[] = deductions.map((deduction) => ({
    findingId: deduction.findingId,
    amount: deduction.amount,
    justificationIds,
  }));

  const prepared = prepareSettlement({
    depositHeld: deposit.balanceAmount,
    keyHandoverDate: sides.exit?.keysHandedOverOn ?? null,
    conforms: comparison.exitConforms,
    candidates,
  });

  return {
    leaseId,
    leaseKind: lease.kind as DepositSettlementRead["leaseKind"],
    exitInspectionId: sides.exit?.id ?? null,
    contractualDeposit: deposit.contractualAmount ?? amountOrNull(lease.depositAmount),
    depositHeld: deposit.balanceAmount,
    keyHandoverDate: sides.exit?.keysHandedOverOn ?? null,
    exitConforms: comparison.exitConforms,
    deductions,
    missingInventory: comparison.inventory
      .filter((item) => item.status === "missing")
      .map((item) => ({ id: item.id, label: item.label })),
    totalDeductions: prepared.settlement?.totalDeductions ?? null,
    restitution: prepared.settlement?.restitution ?? null,
    deadline: prepared.settlement?.deadline ?? null,
    deadlineMonths: prepared.settlement?.deadlineMonths ?? null,
    blockedReason: prepared.blockedReason,
    blockedFindingIds:
      prepared.blockedReason === null || prepared.blockedReason === "keys_not_handed_over"
        ? []
        : deductions.map((deduction) => deduction.findingId),
  };
}
