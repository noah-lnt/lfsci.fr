import "server-only";
import type {
  Building,
  CreateBuildingInput,
  CreateLegalEntityInput,
  CreateUnitInput,
  LegalEntity,
  Unit,
  UnitUsagePeriod,
  UpdateBuildingInput,
  UpdateLegalEntityInput,
  UpdateUnitInput,
} from "@lfsci/contracts";
import {
  ensureObjectRef,
  linkEvent,
  type ObjectKind,
  recordAudit,
  type Tx,
  tables,
} from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { SetUnitUsageInput } from "@/lib/contracts/patrimoine";
import {
  assertVersion,
  decodeCursor,
  encodeCursor,
  page,
  requireRow,
  toBuilding,
  toLegalEntity,
  toUnit,
  toUsagePeriod,
} from "./rows";

export type Scope = { organizationId: string; actorId: string };

type ListArgs = { cursor?: string | undefined; limit: number };

const PG_UNIQUE_VIOLATION = "23505";
const PG_EXCLUSION_VIOLATION = "23P01";

/** Drizzle wraps the driver error, so the SQLSTATE sits on a cause a level down. */
function pgCode(error: unknown): string | undefined {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

type Keyed = { createdAt: PgColumn; id: PgColumn };

/** `(created_at, id) <` the cursor: newest first, ties broken by id. */
function olderThan(table: Keyed, cursor: string | undefined) {
  if (!cursor) return undefined;
  const { at, id } = decodeCursor(cursor);
  return or(lt(table.createdAt, at), and(eq(table.createdAt, at), lt(table.id, id)));
}

function newestFirst(table: Keyed) {
  return [desc(table.createdAt), desc(table.id)];
}

const byCreation = (row: { createdAt: string; id: string }) => encodeCursor(row.createdAt, row.id);

async function writeEvent(
  tx: Tx,
  scope: Scope,
  input: { type: string; kind: ObjectKind; id: string; payload: Record<string, unknown> },
): Promise<void> {
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: scope.organizationId,
    kind: input.kind,
    id: input.id,
  });
  const occurredAt = new Date().toISOString();
  const rows = await tx
    .insert(tables.event)
    .values({
      organizationId: scope.organizationId,
      type: input.type,
      primaryObjectRefId: objectRefId,
      occurredAt,
      origin: "user",
      actorUserId: scope.actorId,
      payload: input.payload,
    })
    .returning({ id: tables.event.id });
  const created = requireRow(rows[0], "event");
  await linkEvent(tx, {
    organizationId: scope.organizationId,
    eventId: created.id,
    objectRefId,
    relation: "primary",
    occurredAt,
  });
}

function audit(
  tx: Tx,
  scope: Scope,
  entry: { table: string; id: string; action: string; before?: unknown; after: unknown },
) {
  return recordAudit(tx, {
    organizationId: scope.organizationId,
    actorKind: "user",
    actorUserId: scope.actorId,
    objectTable: entry.table,
    objectId: entry.id,
    action: entry.action,
    ...(entry.before === undefined ? {} : { beforeValue: entry.before }),
    afterValue: entry.after,
  });
}

// ---------------------------------------------------------------- legal entities

export async function listLegalEntities(
  tx: Tx,
  args: ListArgs & { status?: string | undefined; search?: string | undefined },
) {
  const rows = await tx
    .select()
    .from(tables.legalEntity)
    .where(
      and(
        args.status ? eq(tables.legalEntity.status, args.status) : undefined,
        args.search ? ilike(tables.legalEntity.name, `%${args.search}%`) : undefined,
        olderThan(tables.legalEntity, args.cursor),
      ),
    )
    .orderBy(...newestFirst(tables.legalEntity))
    .limit(args.limit + 1);

  const result = page(rows, args.limit, byCreation);
  return { items: result.items.map(toLegalEntity), nextCursor: result.nextCursor };
}

export async function getLegalEntity(tx: Tx, id: string): Promise<LegalEntity> {
  const rows = await tx.select().from(tables.legalEntity).where(eq(tables.legalEntity.id, id));
  return toLegalEntity(requireRow(rows[0], "legal_entity"));
}

export async function createLegalEntity(
  tx: Tx,
  scope: Scope,
  input: CreateLegalEntityInput,
): Promise<LegalEntity> {
  const rows = await tx
    .insert(tables.legalEntity)
    .values({
      organizationId: scope.organizationId,
      name: input.name,
      legalForm: input.legalForm,
      ...(input.siren === undefined ? {} : { siren: input.siren }),
      ...(input.incomeTaxRegime === undefined ? {} : { incomeTaxRegime: input.incomeTaxRegime }),
      ...(input.vatStatus === undefined ? {} : { vatStatus: input.vatStatus }),
      ...(input.fiscalYearEndMonth === undefined
        ? {}
        : { fiscalYearEndMonth: input.fiscalYearEndMonth }),
      ...(input.fiscalYearEndDay === undefined ? {} : { fiscalYearEndDay: input.fiscalYearEndDay }),
    })
    .returning();
  const entity = toLegalEntity(requireRow(rows[0], "legal_entity"));
  await writeEvent(tx, scope, {
    type: "legal_entity_created",
    kind: "legal_entity",
    id: entity.id,
    payload: { name: entity.name, legalForm: entity.legalForm },
  });
  await audit(tx, scope, {
    table: "legal_entity",
    id: entity.id,
    action: "create",
    after: entity,
  });
  return entity;
}

export async function updateLegalEntity(
  tx: Tx,
  scope: Scope,
  input: UpdateLegalEntityInput,
): Promise<LegalEntity> {
  const before = await tx
    .select()
    .from(tables.legalEntity)
    .where(eq(tables.legalEntity.id, input.id));
  const rows = await tx
    .update(tables.legalEntity)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.siren === undefined ? {} : { siren: input.siren }),
      ...(input.incomeTaxRegime === undefined ? {} : { incomeTaxRegime: input.incomeTaxRegime }),
      ...(input.vatStatus === undefined ? {} : { vatStatus: input.vatStatus }),
      ...(input.eInvoicingChannel === undefined
        ? {}
        : { eInvoicingChannel: input.eInvoicingChannel }),
      ...(input.status === undefined ? {} : { status: input.status }),
      updatedAt: new Date().toISOString(),
      version: sql`${tables.legalEntity.version} + 1`,
    })
    .where(
      and(
        eq(tables.legalEntity.id, input.id),
        eq(tables.legalEntity.version, input.expectedVersion),
      ),
    )
    .returning();
  assertVersion(rows.length === 1, before.length === 1, "legal_entity");
  const entity = toLegalEntity(requireRow(rows[0], "legal_entity"));
  await audit(tx, scope, {
    table: "legal_entity",
    id: entity.id,
    action: "update",
    before: before[0] ? toLegalEntity(before[0]) : null,
    after: entity,
  });
  return entity;
}

// ---------------------------------------------------------------- buildings

export async function listBuildings(
  tx: Tx,
  args: ListArgs & {
    legalEntityId?: string | undefined;
    status?: string | undefined;
    search?: string | undefined;
  },
) {
  const rows = await tx
    .select()
    .from(tables.building)
    .where(
      and(
        args.legalEntityId ? eq(tables.building.legalEntityId, args.legalEntityId) : undefined,
        args.status ? eq(tables.building.status, args.status) : undefined,
        args.search
          ? or(
              ilike(tables.building.name, `%${args.search}%`),
              ilike(tables.building.city, `%${args.search}%`),
              ilike(tables.building.code, `%${args.search}%`),
            )
          : undefined,
        olderThan(tables.building, args.cursor),
      ),
    )
    .orderBy(...newestFirst(tables.building))
    .limit(args.limit + 1);

  const result = page(rows, args.limit, byCreation);
  return { items: result.items.map(toBuilding), nextCursor: result.nextCursor };
}

export async function getBuilding(tx: Tx, id: string): Promise<Building> {
  const rows = await tx.select().from(tables.building).where(eq(tables.building.id, id));
  return toBuilding(requireRow(rows[0], "building"));
}

export async function createBuilding(
  tx: Tx,
  scope: Scope,
  input: CreateBuildingInput,
): Promise<Building> {
  // A foreign legal entity must read as an unknown one (404, never 403).
  await getLegalEntity(tx, input.legalEntityId);
  let rows: (typeof tables.building.$inferSelect)[];
  try {
    rows = await tx
      .insert(tables.building)
      .values({
        organizationId: scope.organizationId,
        legalEntityId: input.legalEntityId,
        code: input.code,
        name: input.name,
        addressLine1: input.addressLine1,
        ...(input.addressLine2 === undefined ? {} : { addressLine2: input.addressLine2 }),
        ...(input.postalCode === undefined ? {} : { postalCode: input.postalCode }),
        ...(input.city === undefined ? {} : { city: input.city }),
        ...(input.countryCode === undefined ? {} : { countryCode: input.countryCode }),
        ...(input.acquiredOn === undefined ? {} : { acquiredOn: input.acquiredOn }),
      })
      .returning();
  } catch (cause) {
    if (pgCode(cause) === PG_UNIQUE_VIOLATION) {
      throw new AppError("CONFLICT", {
        message: "Ce code d’immeuble est déjà utilisé.",
        details: { code: input.code },
        cause,
      });
    }
    throw cause;
  }
  const building = toBuilding(requireRow(rows[0], "building"));
  await writeEvent(tx, scope, {
    type: "building_created",
    kind: "building",
    id: building.id,
    payload: { code: building.code, name: building.name, city: building.city },
  });
  await audit(tx, scope, { table: "building", id: building.id, action: "create", after: building });
  return building;
}

export async function updateBuilding(
  tx: Tx,
  scope: Scope,
  input: UpdateBuildingInput,
): Promise<Building> {
  const before = await tx.select().from(tables.building).where(eq(tables.building.id, input.id));
  const rows = await tx
    .update(tables.building)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.addressLine1 === undefined ? {} : { addressLine1: input.addressLine1 }),
      ...(input.addressLine2 === undefined ? {} : { addressLine2: input.addressLine2 }),
      ...(input.postalCode === undefined ? {} : { postalCode: input.postalCode }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.cadastralRef === undefined ? {} : { cadastralRef: input.cadastralRef }),
      ...(input.soldOn === undefined ? {} : { soldOn: input.soldOn }),
      ...(input.status === undefined ? {} : { status: input.status }),
      updatedAt: new Date().toISOString(),
      version: sql`${tables.building.version} + 1`,
    })
    .where(
      and(eq(tables.building.id, input.id), eq(tables.building.version, input.expectedVersion)),
    )
    .returning();
  assertVersion(rows.length === 1, before.length === 1, "building");
  const building = toBuilding(requireRow(rows[0], "building"));
  await writeEvent(tx, scope, {
    type: "building_updated",
    kind: "building",
    id: building.id,
    payload: { status: building.status },
  });
  await audit(tx, scope, {
    table: "building",
    id: building.id,
    action: "update",
    before: before[0] ? toBuilding(before[0]) : null,
    after: building,
  });
  return building;
}

// ---------------------------------------------------------------- units

export async function listUnits(
  tx: Tx,
  args: ListArgs & {
    buildingId?: string | undefined;
    legalEntityId?: string | undefined;
    kind?: string | undefined;
    status?: string | undefined;
  },
) {
  const rows = await tx
    .select({ unit: tables.unit })
    .from(tables.unit)
    .innerJoin(tables.building, eq(tables.building.id, tables.unit.buildingId))
    .where(
      and(
        args.buildingId ? eq(tables.unit.buildingId, args.buildingId) : undefined,
        args.legalEntityId ? eq(tables.building.legalEntityId, args.legalEntityId) : undefined,
        args.kind ? eq(tables.unit.kind, args.kind) : undefined,
        args.status ? eq(tables.unit.status, args.status) : undefined,
        olderThan(tables.unit, args.cursor),
      ),
    )
    .orderBy(...newestFirst(tables.unit))
    .limit(args.limit + 1);

  const result = page(
    rows.map((row) => row.unit),
    args.limit,
    byCreation,
  );
  return { items: result.items.map(toUnit), nextCursor: result.nextCursor };
}

export async function listUsagePeriods(tx: Tx, unitId: string): Promise<UnitUsagePeriod[]> {
  const rows = await tx
    .select()
    .from(tables.unitUsagePeriod)
    .where(eq(tables.unitUsagePeriod.unitId, unitId))
    .orderBy(desc(tables.unitUsagePeriod.startsOn));
  return rows.map(toUsagePeriod);
}

export async function getUnit(
  tx: Tx,
  id: string,
): Promise<Unit & { usagePeriods: UnitUsagePeriod[] }> {
  const rows = await tx.select().from(tables.unit).where(eq(tables.unit.id, id));
  const unit = toUnit(requireRow(rows[0], "unit"));
  return { ...unit, usagePeriods: await listUsagePeriods(tx, id) };
}

export async function createUnit(tx: Tx, scope: Scope, input: CreateUnitInput): Promise<Unit> {
  await getBuilding(tx, input.buildingId);
  let rows: (typeof tables.unit.$inferSelect)[];
  try {
    rows = await tx
      .insert(tables.unit)
      .values({
        organizationId: scope.organizationId,
        buildingId: input.buildingId,
        code: input.code,
        label: input.label,
        kind: input.kind,
        ...(input.floor === undefined ? {} : { floor: input.floor }),
        ...(input.roomCount === undefined ? {} : { roomCount: input.roomCount }),
        ...(input.livingAreaSqm === undefined ? {} : { livingAreaSqm: input.livingAreaSqm }),
        ...(input.ownershipShare === undefined ? {} : { ownershipShare: input.ownershipShare }),
        ...(input.energyClass === undefined ? {} : { energyClass: input.energyClass }),
      })
      .returning();
  } catch (cause) {
    if (pgCode(cause) === PG_UNIQUE_VIOLATION) {
      throw new AppError("CONFLICT", {
        message: "Ce code de lot est déjà utilisé dans cet immeuble.",
        details: { code: input.code },
        cause,
      });
    }
    throw cause;
  }
  const unit = toUnit(requireRow(rows[0], "unit"));
  await writeEvent(tx, scope, {
    type: "unit_created",
    kind: "unit",
    id: unit.id,
    payload: { code: unit.code, label: unit.label, kind: unit.kind },
  });
  await audit(tx, scope, { table: "unit", id: unit.id, action: "create", after: unit });
  return unit;
}

export async function updateUnit(tx: Tx, scope: Scope, input: UpdateUnitInput): Promise<Unit> {
  const before = await tx.select().from(tables.unit).where(eq(tables.unit.id, input.id));
  const rows = await tx
    .update(tables.unit)
    .set({
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.floor === undefined ? {} : { floor: input.floor }),
      ...(input.roomCount === undefined ? {} : { roomCount: input.roomCount }),
      ...(input.livingAreaSqm === undefined ? {} : { livingAreaSqm: input.livingAreaSqm }),
      ...(input.energyClass === undefined ? {} : { energyClass: input.energyClass }),
      ...(input.energyAuditOn === undefined ? {} : { energyAuditOn: input.energyAuditOn }),
      ...(input.status === undefined ? {} : { status: input.status }),
      updatedAt: new Date().toISOString(),
      version: sql`${tables.unit.version} + 1`,
    })
    .where(and(eq(tables.unit.id, input.id), eq(tables.unit.version, input.expectedVersion)))
    .returning();
  assertVersion(rows.length === 1, before.length === 1, "unit");
  const unit = toUnit(requireRow(rows[0], "unit"));
  await writeEvent(tx, scope, {
    type: "unit_updated",
    kind: "unit",
    id: unit.id,
    payload: { label: unit.label, status: unit.status },
  });
  await audit(tx, scope, {
    table: "unit",
    id: unit.id,
    action: "update",
    before: before[0] ? toUnit(before[0]) : null,
    after: unit,
  });
  return unit;
}

/**
 * PAT-01: the running period is closed the day the new one opens, then the new
 * one is inserted. The `daterange` exclusion constraint is the referee.
 */
export async function setUnitUsage(
  tx: Tx,
  scope: Scope,
  input: SetUnitUsageInput,
): Promise<{ unit: Unit; usagePeriods: UnitUsagePeriod[] }> {
  const unit = await getUnit(tx, input.unitId);

  await tx
    .update(tables.unitUsagePeriod)
    .set({
      endsOn: input.startsOn,
      updatedAt: new Date().toISOString(),
      version: sql`${tables.unitUsagePeriod.version} + 1`,
    })
    .where(
      and(
        eq(tables.unitUsagePeriod.unitId, input.unitId),
        isNull(tables.unitUsagePeriod.endsOn),
        lt(tables.unitUsagePeriod.startsOn, input.startsOn),
      ),
    );

  try {
    await tx.insert(tables.unitUsagePeriod).values({
      organizationId: scope.organizationId,
      unitId: input.unitId,
      usage: input.usage,
      startsOn: input.startsOn,
      ...(input.endsOn === undefined ? {} : { endsOn: input.endsOn }),
      ...(input.note === undefined ? {} : { note: input.note }),
    });
  } catch (cause) {
    if (pgCode(cause) === PG_EXCLUSION_VIOLATION) {
      throw new AppError("CONFLICT", {
        message:
          "Cette période chevauche un usage déjà enregistré pour ce lot ; corrigez la date de début.",
        details: { unitId: input.unitId, startsOn: input.startsOn },
        cause,
      });
    }
    throw cause;
  }

  await writeEvent(tx, scope, {
    type: "unit_usage_changed",
    kind: "unit",
    id: input.unitId,
    payload: { usage: input.usage, startsOn: input.startsOn },
  });
  await audit(tx, scope, {
    table: "unit_usage_period",
    id: input.unitId,
    action: "set_usage",
    after: { usage: input.usage, startsOn: input.startsOn, endsOn: input.endsOn ?? null },
  });

  return { unit, usagePeriods: await listUsagePeriods(tx, input.unitId) };
}

// ---------------------------------------------------------------- tree

export type TreeUnit = Unit & { currentUsage: UnitUsagePeriod["usage"] | null };
export type TreeBuilding = Building & { units: TreeUnit[] };
export type TreeEntity = LegalEntity & { buildings: TreeBuilding[] };

/** SCI → immeubles → lots in one pass, with each lot's usage on the given day. */
export async function readTree(tx: Tx, on: string): Promise<TreeEntity[]> {
  const entities = await tx
    .select()
    .from(tables.legalEntity)
    .orderBy(asc(tables.legalEntity.name), asc(tables.legalEntity.id));
  if (entities.length === 0) return [];

  const buildings = await tx
    .select()
    .from(tables.building)
    .where(
      inArray(
        tables.building.legalEntityId,
        entities.map((entity) => entity.id),
      ),
    )
    .orderBy(asc(tables.building.code), asc(tables.building.id));

  const units =
    buildings.length === 0
      ? []
      : await tx
          .select()
          .from(tables.unit)
          .where(
            inArray(
              tables.unit.buildingId,
              buildings.map((building) => building.id),
            ),
          )
          .orderBy(asc(tables.unit.code), asc(tables.unit.id));

  const usages =
    units.length === 0
      ? []
      : await tx
          .select({
            unitId: tables.unitUsagePeriod.unitId,
            usage: tables.unitUsagePeriod.usage,
          })
          .from(tables.unitUsagePeriod)
          .where(
            and(
              inArray(
                tables.unitUsagePeriod.unitId,
                units.map((unit) => unit.id),
              ),
              sql`${tables.unitUsagePeriod.startsOn} <= ${on}::date`,
              or(isNull(tables.unitUsagePeriod.endsOn), gt(tables.unitUsagePeriod.endsOn, on)),
            ),
          );

  const usageByUnit = new Map(usages.map((row) => [row.unitId, row.usage]));
  const unitsByBuilding = new Map<string, TreeUnit[]>();
  for (const row of units) {
    const list = unitsByBuilding.get(row.buildingId) ?? [];
    list.push({
      ...toUnit(row),
      currentUsage: (usageByUnit.get(row.id) as TreeUnit["currentUsage"]) ?? null,
    });
    unitsByBuilding.set(row.buildingId, list);
  }

  const buildingsByEntity = new Map<string, TreeBuilding[]>();
  for (const row of buildings) {
    const list = buildingsByEntity.get(row.legalEntityId) ?? [];
    list.push({ ...toBuilding(row), units: unitsByBuilding.get(row.id) ?? [] });
    buildingsByEntity.set(row.legalEntityId, list);
  }

  return entities.map((row) => ({
    ...toLegalEntity(row),
    buildings: buildingsByEntity.get(row.id) ?? [],
  }));
}
