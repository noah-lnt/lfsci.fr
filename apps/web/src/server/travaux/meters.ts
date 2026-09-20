import "server-only";
import type { Meter } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { decimal } from "@lfsci/domain";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { CreateMeterInput, MeterReadingRow, MeterRow } from "@/lib/contracts/travaux";
import { type Actor, audit, recordFact } from "../finance/facts";
import { DEFAULT_LIMIT, firstOr, nextCursor, offsetFromCursor } from "../finance/shared";
import { mapMeter, mapMeterReadingRow } from "./mappers";

type ReadingRow = typeof tables.meterReading.$inferSelect;

async function previousReading(
  tx: Tx,
  meterId: string,
  readOn: string,
  excludeId?: string,
): Promise<ReadingRow | undefined> {
  const rows = await tx
    .select()
    .from(tables.meterReading)
    .where(
      and(
        eq(tables.meterReading.meterId, meterId),
        lte(tables.meterReading.readOn, readOn),
        sql`${tables.meterReading.status} <> 'rejected'`,
        excludeId ? sql`${tables.meterReading.id} <> ${excludeId}` : undefined,
      ),
    )
    .orderBy(desc(tables.meterReading.readOn), desc(tables.meterReading.createdAt))
    .limit(1);
  return rows[0];
}

export async function listMeters(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    buildingId?: string | undefined;
    unitId?: string | undefined;
  },
): Promise<{ items: MeterRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);

  const servedMeters = input.unitId
    ? await tx
        .select({ meterId: tables.meterServicePeriod.meterId })
        .from(tables.meterServicePeriod)
        .where(eq(tables.meterServicePeriod.unitId, input.unitId))
    : null;

  const filters = [
    input.buildingId ? eq(tables.meter.buildingId, input.buildingId) : undefined,
    servedMeters
      ? inArray(
          tables.meter.id,
          servedMeters.length > 0 ? servedMeters.map((row) => row.meterId) : [""],
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select({ meter: tables.meter, buildingLabel: tables.building.name })
    .from(tables.meter)
    .innerJoin(tables.building, eq(tables.meter.buildingId, tables.building.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tables.meter.fluid), asc(tables.meter.serialNumber))
    .limit(limit + 1)
    .offset(offset);
  const page = rows.slice(0, limit);

  const items: MeterRow[] = [];
  for (const row of page) {
    const last = await tx
      .select()
      .from(tables.meterReading)
      .where(eq(tables.meterReading.meterId, row.meter.id))
      .orderBy(desc(tables.meterReading.readOn))
      .limit(1);
    const exceptions = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(tables.meterReading)
      .where(
        and(
          eq(tables.meterReading.meterId, row.meter.id),
          eq(tables.meterReading.status, "exception"),
        ),
      );
    items.push({
      ...mapMeter(row.meter),
      buildingLabel: row.buildingLabel,
      lastIndexValue: last[0]?.indexValue ?? null,
      lastReadOn: last[0]?.readOn ?? null,
      openExceptions: exceptions[0]?.count ?? 0,
    });
  }
  return { items, nextCursor: nextCursor(offset, limit, rows.length) };
}

/** COM-01: fluid, unit, identifiers and multiplier belong to the meter itself. */
export async function createMeter(tx: Tx, actor: Actor, input: CreateMeterInput): Promise<Meter> {
  const row = firstOr(
    await tx
      .insert(tables.meter)
      .values({
        organizationId: actor.organizationId,
        buildingId: input.buildingId,
        fluid: input.fluid,
        scope: input.scope,
        unitOfMeasure: input.unitOfMeasure,
        multiplier: input.multiplier ?? "1",
        serialNumber: input.serialNumber ?? null,
        prmPdl: input.prmPdl ?? null,
        pce: input.pce ?? null,
        locationNote: input.locationNote ?? null,
        installedOn: input.installedOn ?? null,
        status: "active",
      })
      .returning(),
    "Compteur",
  );
  await audit(tx, actor, {
    objectTable: "meter",
    objectId: row.id,
    action: "create",
    after: { fluid: row.fluid, scope: row.scope },
  });
  return mapMeter(row);
}

export async function listReadings(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    meterId: string;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<{ items: MeterReadingRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const meter = firstOr(
    await tx.select().from(tables.meter).where(eq(tables.meter.id, input.meterId)).limit(1),
    "Compteur",
  );
  const rows = await tx
    .select()
    .from(tables.meterReading)
    .where(
      and(
        eq(tables.meterReading.meterId, input.meterId),
        input.from ? gte(tables.meterReading.readOn, input.from) : undefined,
        input.to ? lte(tables.meterReading.readOn, input.to) : undefined,
      ),
    )
    .orderBy(desc(tables.meterReading.readOn), desc(tables.meterReading.createdAt))
    .limit(limit + 1)
    .offset(offset);

  const page = rows.slice(0, limit);
  const items: MeterReadingRow[] = [];
  for (const row of page) {
    const previous = await previousReading(tx, input.meterId, row.readOn, row.id);
    items.push(mapMeterReadingRow(row, previous?.indexValue ?? null, meter));
  }
  return { items, nextCursor: nextCursor(offset, limit, rows.length) };
}

/**
 * COM-01: an index below the previous one is stored as an exception with its
 * reason. No negative consumption is ever produced, and the reading is kept —
 * refusing it would lose the fact the owner actually read on the meter.
 */
export async function recordReading(
  tx: Tx,
  actor: Actor,
  input: {
    meterId: string;
    indexValue: string;
    readOn: string;
    origin: string;
    photoDocumentId?: string | undefined;
    isAfterReset?: boolean | undefined;
    exceptionReason?: string | undefined;
  },
): Promise<MeterReadingRow> {
  const meter = firstOr(
    await tx.select().from(tables.meter).where(eq(tables.meter.id, input.meterId)).limit(1),
    "Compteur",
  );
  const previous = await previousReading(tx, input.meterId, input.readOn);
  const isAfterReset = input.isAfterReset ?? false;
  const wentBackwards =
    previous !== undefined &&
    !isAfterReset &&
    decimal(input.indexValue).lessThan(decimal(previous.indexValue));

  const exceptionReason = wentBackwards
    ? (input.exceptionReason ??
      `Index ${input.indexValue} inférieur au relevé précédent ${previous.indexValue} du ${previous.readOn} : consommation négative refusée, exception ouverte.`)
    : (input.exceptionReason ?? null);

  const row = firstOr(
    await tx
      .insert(tables.meterReading)
      .values({
        organizationId: actor.organizationId,
        meterId: meter.id,
        indexValue: input.indexValue,
        readOn: input.readOn,
        origin: input.origin,
        photoDocumentId: input.photoDocumentId ?? null,
        isAfterReset,
        exceptionReason,
        status: wentBackwards ? "exception" : "recorded",
      })
      .returning(),
    "Relevé",
  );

  const { objectRefId } = await recordFact(tx, actor, {
    kind: "meter",
    id: meter.id,
    type: wentBackwards ? "meter.reading_exception" : "meter.reading_recorded",
    payload: { readingId: row.id, indexValue: row.indexValue, readOn: row.readOn },
  });
  await audit(tx, actor, {
    objectTable: "meter_reading",
    objectId: row.id,
    objectRefId,
    action: "record",
    after: { indexValue: row.indexValue, status: row.status },
    ...(exceptionReason ? { reason: exceptionReason } : {}),
  });

  return mapMeterReadingRow(row, previous?.indexValue ?? null, meter);
}
