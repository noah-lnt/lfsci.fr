import "server-only";
import type { Equipment } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  CreateEquipmentInput,
  EquipmentRow,
  UpdateEquipmentInput,
} from "@/lib/contracts/travaux";
import { type Actor, audit } from "../finance/facts";
import {
  DEFAULT_LIMIT,
  firstOr,
  nextCursor,
  offsetFromCursor,
  versionConflict,
} from "../finance/shared";
import { mapEquipment } from "./mappers";

/** EQU-01: the physical equipment; its accounting asset is a separate object. */
export async function listEquipment(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    buildingId?: string | undefined;
    unitId?: string | undefined;
    status?: string | undefined;
  },
): Promise<{ items: EquipmentRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);

  const assigned =
    input.buildingId || input.unitId
      ? await tx
          .select({ equipmentId: tables.equipmentAssignment.equipmentId })
          .from(tables.equipmentAssignment)
          .where(
            and(
              input.buildingId
                ? eq(tables.equipmentAssignment.buildingId, input.buildingId)
                : undefined,
              input.unitId ? eq(tables.equipmentAssignment.unitId, input.unitId) : undefined,
            ),
          )
      : null;

  const filters = [
    input.status ? eq(tables.equipment.status, input.status) : undefined,
    assigned
      ? inArray(
          tables.equipment.id,
          assigned.length > 0 ? assigned.map((row) => row.equipmentId) : [""],
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select({ equipment: tables.equipment, supplierName: tables.supplier.name })
    .from(tables.equipment)
    .leftJoin(tables.supplier, eq(tables.equipment.supplierId, tables.supplier.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tables.equipment.label))
    .limit(limit + 1)
    .offset(offset);

  return {
    items: rows.slice(0, limit).map((row) => ({
      ...mapEquipment(row.equipment),
      supplierName: row.supplierName,
    })),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function createEquipment(
  tx: Tx,
  actor: Actor,
  input: CreateEquipmentInput,
): Promise<Equipment> {
  const row = firstOr(
    await tx
      .insert(tables.equipment)
      .values({
        organizationId: actor.organizationId,
        category: input.category,
        label: input.label,
        brand: input.brand ?? null,
        model: input.model ?? null,
        serialNumber: input.serialNumber ?? null,
        purchasedOn: input.purchasedOn ?? null,
        commissionedOn: input.commissionedOn ?? null,
        documentedCost: input.documentedCost ?? null,
        warrantyUntil: input.warrantyUntil ?? null,
        supplierId: input.supplierId ?? null,
        status: input.status ?? "in_service",
      })
      .returning(),
    "Équipement",
  );
  await audit(tx, actor, {
    objectTable: "equipment",
    objectId: row.id,
    action: "create",
    after: { label: row.label, category: row.category },
  });
  return mapEquipment(row);
}

export async function updateEquipment(
  tx: Tx,
  actor: Actor,
  input: UpdateEquipmentInput,
): Promise<Equipment> {
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.brand === undefined ? {} : { brand: input.brand }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.serialNumber === undefined ? {} : { serialNumber: input.serialNumber }),
    ...(input.warrantyUntil === undefined ? {} : { warrantyUntil: input.warrantyUntil }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  const updated = await tx
    .update(tables.equipment)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(eq(tables.equipment.id, input.id), eq(tables.equipment.version, input.expectedVersion)),
    )
    .returning();
  const row = updated[0];
  if (!row) versionConflict("L’équipement");
  await audit(tx, actor, {
    objectTable: "equipment",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return mapEquipment(row);
}
