import "server-only";
import type { BookingMovementKind, BookingStatus, ListingStatus } from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type {
  AvailabilityRead,
  BookingDetail,
  BookingRow,
  CalendarRead,
  CourteDureeLookups,
  CreateBookingInput,
  CreateListingInput,
  ImportPreview,
  ImportResult,
  ListingDetail,
  ListingRow,
  PayoutDetailRead,
  PayoutRow,
  UpdateBookingInput,
  UpdateListingInput,
} from "@/lib/contracts/courte-duree";
import { type Actor, audit, recordFact } from "../finance/facts";
import {
  amount,
  DEFAULT_LIMIT,
  firstOr,
  instant,
  instantOrNow,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  versionConflict,
} from "../finance/shared";
import { parseCsv } from "./csv";
import { describeMapping, IMPORT_MAPPINGS, resolveMapping } from "./mapping";
import {
  type ImportPlan,
  type KnownBooking,
  newBookings,
  newPayouts,
  planImport,
  reconciliationOf,
} from "./plan";

const ZERO = "0.00";
const PICKER_LIMIT = 200;

/**
 * AIR-03: the platforms refresh an imported calendar on their own schedule, so
 * past this window the feed is presented as possibly outdated rather than as a
 * guarantee against a double booking.
 */
const ICAL_FRESHNESS_HOURS = 24;

const LISTING_TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: ["active"],
};

const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  blocked: ["pending", "confirmed", "cancelled"],
  pending: ["confirmed", "cancelled"],
  confirmed: ["in_stay", "cancelled", "disputed"],
  in_stay: ["completed", "disputed"],
  completed: ["disputed"],
  cancelled: [],
  disputed: ["completed", "cancelled"],
};

const unitLabel = sql<string>`${tables.unit.code} || ' — ' || ${tables.unit.label}`;

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nights(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function staleness(lastPolledAt: string | null): { neverPolled: boolean; stale: boolean } {
  if (!lastPolledAt) return { neverPolled: true, stale: true };
  const age = Date.now() - Date.parse(lastPolledAt);
  return { neverPolled: false, stale: age > ICAL_FRESHNESS_HOURS * 3_600_000 };
}

export async function courteDureeLookups(tx: Tx): Promise<CourteDureeLookups> {
  const [units, legalEntities, listings] = await Promise.all([
    tx
      .select({ id: tables.unit.id, label: unitLabel })
      .from(tables.unit)
      .orderBy(asc(tables.unit.code))
      .limit(PICKER_LIMIT),
    tx
      .select({ id: tables.legalEntity.id, label: tables.legalEntity.name })
      .from(tables.legalEntity)
      .orderBy(asc(tables.legalEntity.name))
      .limit(PICKER_LIMIT),
    tx
      .select({
        id: tables.listing.id,
        label: sql<string>`coalesce(${tables.listing.title}, ${tables.unit.label})`,
        platform: tables.listing.platform,
        status: tables.listing.status,
      })
      .from(tables.listing)
      .innerJoin(tables.unit, eq(tables.unit.id, tables.listing.unitId))
      .orderBy(asc(tables.listing.createdAt))
      .limit(PICKER_LIMIT),
  ]);
  return {
    units,
    legalEntities,
    listings: listings.map((listing) => ({
      id: listing.id,
      label: listing.label,
      platform: listing.platform as CourteDureeLookups["listings"][number]["platform"],
      status: listing.status as ListingStatus,
    })),
  };
}

const listingColumns = {
  id: tables.listing.id,
  unitId: tables.listing.unitId,
  unitLabel,
  buildingName: tables.building.name,
  platform: tables.listing.platform,
  externalListingId: tables.listing.externalListingId,
  title: tables.listing.title,
  status: tables.listing.status,
  icalImportUrl: tables.listing.icalImportUrl,
  icalExportUrl: tables.listing.icalExportUrl,
  icalLastPolledAt: tables.listing.icalLastPolledAt,
  registrationNumber: tables.listing.registrationNumber,
  registrationCheckedOn: tables.listing.registrationCheckedOn,
  createdAt: tables.listing.createdAt,
  version: tables.listing.version,
  bookingCount: sql<number>`(
    SELECT count(*)::int FROM booking b WHERE b.listing_id = ${tables.listing.id}
  )`,
  nextCheckInOn: sql<string | null>`(
    SELECT min(b.check_in_on) FROM booking b
    WHERE b.listing_id = ${tables.listing.id}
      AND b.status NOT IN ('cancelled')
      AND b.check_out_on >= current_date
  )`,
};

type ListingSelected = Awaited<ReturnType<typeof selectListings>>[number];

function selectListings(tx: Tx) {
  return tx
    .select(listingColumns)
    .from(tables.listing)
    .innerJoin(tables.unit, eq(tables.unit.id, tables.listing.unitId))
    .innerJoin(tables.building, eq(tables.building.id, tables.unit.buildingId));
}

function mapListing(row: ListingSelected): ListingRow {
  return {
    id: row.id,
    unitId: row.unitId,
    unitLabel: row.unitLabel,
    buildingName: row.buildingName,
    platform: row.platform as ListingRow["platform"],
    externalListingId: row.externalListingId,
    title: row.title,
    status: row.status as ListingStatus,
    icalImportUrl: row.icalImportUrl,
    icalExportUrl: row.icalExportUrl,
    icalLastPolledAt: instant(row.icalLastPolledAt),
    registrationNumber: row.registrationNumber,
    registrationCheckedOn: row.registrationCheckedOn,
    bookingCount: row.bookingCount,
    nextCheckInOn: row.nextCheckInOn,
    version: row.version,
  };
}

export async function listListings(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    status?: string | undefined;
    platform?: string | undefined;
    search?: string | undefined;
  },
): Promise<{ items: ListingRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.status ? eq(tables.listing.status, input.status) : undefined,
    input.platform ? eq(tables.listing.platform, input.platform) : undefined,
    input.search
      ? or(
          ilike(tables.listing.title, `%${input.search}%`),
          ilike(tables.listing.registrationNumber, `%${input.search}%`),
          ilike(tables.unit.label, `%${input.search}%`),
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await selectListings(tx)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.listing.createdAt))
    .limit(limit + 1)
    .offset(offset);

  return {
    items: rows.slice(0, limit).map(mapListing),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function availabilityFor(
  tx: Tx,
  listingId: string,
  range?: { from?: string | undefined; to?: string | undefined },
): Promise<AvailabilityRead> {
  const listing = firstOr(
    await tx.select().from(tables.listing).where(eq(tables.listing.id, listingId)).limit(1),
    "Annonce",
  );
  const filters = [
    eq(tables.booking.listingId, listingId),
    sql`${tables.booking.status} <> 'cancelled'`,
    range?.from ? gte(tables.booking.checkOutOn, range.from) : undefined,
    range?.to ? lte(tables.booking.checkInOn, range.to) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await tx
    .select({
      id: tables.booking.id,
      externalBookingId: tables.booking.externalBookingId,
      checkInOn: tables.booking.checkInOn,
      checkOutOn: tables.booking.checkOutOn,
      source: tables.booking.source,
      status: tables.booking.status,
      guestName: tables.person.displayName,
    })
    .from(tables.booking)
    .leftJoin(tables.person, eq(tables.person.id, tables.booking.guestPersonId))
    .where(and(...filters))
    .orderBy(asc(tables.booking.checkInOn));

  return {
    listingId,
    icalImportUrl: listing.icalImportUrl,
    lastPolledAt: instant(listing.icalLastPolledAt),
    ...staleness(instant(listing.icalLastPolledAt)),
    blocks: rows.map((row) => ({
      reference: row.externalBookingId ?? row.id,
      bookingId: row.id,
      startsOn: row.checkInOn,
      endsOn: addDays(row.checkOutOn, -1),
      nights: nights(row.checkInOn, row.checkOutOn),
      label: row.guestName,
      source: (row.source ?? "manual") as AvailabilityRead["blocks"][number]["source"],
    })),
  };
}

export async function getListing(tx: Tx, id: string): Promise<ListingDetail> {
  const row = firstOr(
    await selectListings(tx).where(eq(tables.listing.id, id)).limit(1),
    "Annonce",
  );
  return {
    ...mapListing(row),
    createdAt: instantOrNow(row.createdAt),
    availability: await availabilityFor(tx, id),
  };
}

export async function createListing(
  tx: Tx,
  actor: Actor,
  input: CreateListingInput,
): Promise<ListingDetail> {
  const inserted = await tx
    .insert(tables.listing)
    .values({
      organizationId: actor.organizationId,
      unitId: input.unitId,
      platform: input.platform,
      title: input.title ?? null,
      externalListingId: input.externalListingId ?? null,
      icalImportUrl: input.icalImportUrl ?? null,
      icalExportUrl: input.icalExportUrl ?? null,
      registrationNumber: input.registrationNumber ?? null,
      registrationCheckedOn: input.registrationCheckedOn ?? null,
      status: input.status ?? "draft",
    })
    .returning({ id: tables.listing.id });
  const id = inserted[0]?.id;
  if (!id) ruleViolation("L’annonce n’a pas pu être créée.");
  await recordFact(tx, actor, { kind: "listing", id, type: "listing.created" });
  await audit(tx, actor, {
    objectTable: "listing",
    objectId: id,
    action: "create",
    after: { ...input },
  });
  return getListing(tx, id);
}

export async function updateListing(
  tx: Tx,
  actor: Actor,
  input: UpdateListingInput,
): Promise<ListingDetail> {
  const before = firstOr(
    await tx.select().from(tables.listing).where(eq(tables.listing.id, input.id)).limit(1),
    "Annonce",
  );
  if (before.version !== input.expectedVersion) versionConflict("L’annonce");
  const patch = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.externalListingId !== undefined
      ? { externalListingId: input.externalListingId }
      : {}),
    ...(input.icalImportUrl !== undefined ? { icalImportUrl: input.icalImportUrl } : {}),
    ...(input.icalExportUrl !== undefined ? { icalExportUrl: input.icalExportUrl } : {}),
    ...(input.registrationNumber !== undefined
      ? { registrationNumber: input.registrationNumber }
      : {}),
    ...(input.registrationCheckedOn !== undefined
      ? { registrationCheckedOn: input.registrationCheckedOn }
      : {}),
  };
  await tx
    .update(tables.listing)
    .set({ ...patch, updatedAt: new Date().toISOString(), version: before.version + 1 })
    .where(eq(tables.listing.id, input.id));
  await audit(tx, actor, {
    objectTable: "listing",
    objectId: input.id,
    action: "update",
    before,
    after: patch,
  });
  return getListing(tx, input.id);
}

export async function setListingStatus(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number; status: ListingStatus },
): Promise<ListingDetail> {
  const before = firstOr(
    await tx.select().from(tables.listing).where(eq(tables.listing.id, input.id)).limit(1),
    "Annonce",
  );
  if (before.version !== input.expectedVersion) versionConflict("L’annonce");
  const allowed = LISTING_TRANSITIONS[before.status as ListingStatus] ?? [];
  if (!allowed.includes(input.status)) {
    ruleViolation("Cette annonce ne peut pas passer dans cet état.", {
      from: before.status,
      to: input.status,
    });
  }
  await tx
    .update(tables.listing)
    .set({
      status: input.status,
      updatedAt: new Date().toISOString(),
      version: before.version + 1,
    })
    .where(eq(tables.listing.id, input.id));
  await recordFact(tx, actor, {
    kind: "listing",
    id: input.id,
    type: "listing.status_changed",
    payload: { from: before.status, to: input.status },
  });
  await audit(tx, actor, {
    objectTable: "listing",
    objectId: input.id,
    action: "status",
    before: { status: before.status },
    after: { status: input.status },
  });
  return getListing(tx, input.id);
}

const bookingColumns = {
  id: tables.booking.id,
  listingId: tables.booking.listingId,
  listingLabel: sql<string>`coalesce(${tables.listing.title}, ${tables.unit.label})`,
  unitId: tables.booking.unitId,
  unitLabel,
  buildingName: tables.building.name,
  platform: tables.booking.platform,
  externalBookingId: tables.booking.externalBookingId,
  guestPersonId: tables.booking.guestPersonId,
  guestName: tables.person.displayName,
  guestCount: tables.booking.guestCount,
  checkInOn: tables.booking.checkInOn,
  checkOutOn: tables.booking.checkOutOn,
  accommodationAmount: tables.booking.accommodationAmount,
  cleaningAmount: tables.booking.cleaningAmount,
  commissionAmount: tables.booking.commissionAmount,
  refundAmount: tables.booking.refundAmount,
  touristTaxCollected: tables.booking.touristTaxCollected,
  touristTaxRemitted: tables.booking.touristTaxRemitted,
  depositAmount: tables.booking.depositAmount,
  currency: tables.booking.currency,
  status: tables.booking.status,
  source: tables.booking.source,
  createdAt: tables.booking.createdAt,
  version: tables.booking.version,
  payoutCount: sql<number>`(
    SELECT count(DISTINCT pd.payout_id)::int FROM payout_detail pd
    WHERE pd.booking_id = ${tables.booking.id}
  )`,
};

type BookingSelected = Awaited<ReturnType<typeof selectBookings>>[number];

function selectBookings(tx: Tx) {
  return tx
    .select(bookingColumns)
    .from(tables.booking)
    .innerJoin(tables.listing, eq(tables.listing.id, tables.booking.listingId))
    .innerJoin(tables.unit, eq(tables.unit.id, tables.booking.unitId))
    .innerJoin(tables.building, eq(tables.building.id, tables.unit.buildingId))
    .leftJoin(tables.person, eq(tables.person.id, tables.booking.guestPersonId));
}

function mapBooking(row: BookingSelected): BookingRow {
  const line = {
    accommodation: amount(row.accommodationAmount),
    cleaning: amount(row.cleaningAmount),
    commission: amount(row.commissionAmount),
    refund: amount(row.refundAmount),
    taxCollected: amount(row.touristTaxCollected),
    taxRemitted: amount(row.touristTaxRemitted),
  };
  const reconciliation = reconciliationOf({
    externalPayoutId: null,
    paidOn: row.checkOutOn,
    currency: row.currency,
    declaredNet: ZERO,
    bookings: [
      {
        reference: row.id,
        bookingId: row.id,
        booking: {
          bookingId: row.id,
          accommodation: line.accommodation,
          cleaning: line.cleaning,
          refunds: line.refund,
          commission: line.commission,
          taxCollected: line.taxCollected,
          taxRemitted: line.taxRemitted,
        },
      },
    ],
    adjustments: [],
    unexplained: [],
  });
  return {
    id: row.id,
    listingId: row.listingId,
    listingLabel: row.listingLabel,
    platform: row.platform as BookingRow["platform"],
    externalBookingId: row.externalBookingId,
    status: row.status as BookingStatus,
    source: row.source as BookingRow["source"],
    currency: row.currency,
    stay: {
      unitId: row.unitId,
      unitLabel: row.unitLabel,
      buildingName: row.buildingName,
      checkInOn: row.checkInOn,
      checkOutOn: row.checkOutOn,
      nights: nights(row.checkInOn, row.checkOutOn),
      guestCount: row.guestCount,
      guestName: row.guestName,
    },
    line: {
      grossServices: reconciliation.grossServices,
      refunds: reconciliation.refunds,
      netOfRefunds: reconciliation.revenueRecognised,
      commission: reconciliation.commissions,
      taxCollected: reconciliation.taxCollected,
      taxRemitted: reconciliation.taxRemitted,
      taxFlow: reconciliation.taxFlow,
      net: reconciliation.bookingNet,
    },
    depositAmount: amount(row.depositAmount),
    payoutCount: row.payoutCount,
    version: row.version,
  };
}

export async function listBookings(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    listingId?: string | undefined;
    status?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    search?: string | undefined;
  },
): Promise<{ items: BookingRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.listingId ? eq(tables.booking.listingId, input.listingId) : undefined,
    input.status ? eq(tables.booking.status, input.status) : undefined,
    input.from ? gte(tables.booking.checkOutOn, input.from) : undefined,
    input.to ? lte(tables.booking.checkInOn, input.to) : undefined,
    input.search
      ? or(
          ilike(tables.booking.externalBookingId, `%${input.search}%`),
          ilike(tables.person.displayName, `%${input.search}%`),
        )
      : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await selectBookings(tx)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.booking.checkInOn))
    .limit(limit + 1)
    .offset(offset);

  return {
    items: rows.slice(0, limit).map(mapBooking),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getBooking(tx: Tx, id: string): Promise<BookingDetail> {
  const row = firstOr(await selectBookings(tx).where(eq(tables.booking.id, id)).limit(1), "Séjour");
  const [movements, payouts] = await Promise.all([
    tx
      .select()
      .from(tables.bookingMovement)
      .where(eq(tables.bookingMovement.bookingId, id))
      .orderBy(asc(tables.bookingMovement.occurredOn)),
    tx
      .select({
        payoutId: tables.payout.id,
        externalPayoutId: tables.payout.externalPayoutId,
        paidOn: tables.payout.paidOn,
        status: tables.payout.status,
        amount: tables.payoutDetail.amount,
        label: tables.payoutDetail.label,
      })
      .from(tables.payoutDetail)
      .innerJoin(tables.payout, eq(tables.payout.id, tables.payoutDetail.payoutId))
      .where(eq(tables.payoutDetail.bookingId, id))
      .orderBy(asc(tables.payout.paidOn)),
  ]);

  const base = mapBooking(row);
  return {
    ...base,
    createdAt: instantOrNow(row.createdAt),
    accommodationAmount: amount(row.accommodationAmount),
    cleaningAmount: amount(row.cleaningAmount),
    commissionAmount: amount(row.commissionAmount),
    refundAmount: amount(row.refundAmount),
    touristTaxCollected: amount(row.touristTaxCollected),
    touristTaxRemitted: amount(row.touristTaxRemitted),
    movements: movements.map((movement) => ({
      id: movement.id,
      kind: movement.kind as BookingMovementKind,
      amount: amount(movement.amount),
      currency: movement.currency,
      occurredOn: movement.occurredOn,
      isThirdPartyTax: movement.isThirdPartyTax,
      externalReference: movement.externalReference,
    })),
    payouts: payouts.map((payout) => ({
      payoutId: payout.payoutId,
      externalPayoutId: payout.externalPayoutId,
      paidOn: payout.paidOn,
      amount: amount(payout.amount),
      label: payout.label,
      status: payout.status as PayoutRow["status"],
    })),
    allowedTransitions: BOOKING_TRANSITIONS[base.status] ?? [],
  };
}

async function guestPersonId(
  tx: Tx,
  actor: Actor,
  displayName: string | null,
): Promise<string | null> {
  if (!displayName) return null;
  const existing = await tx
    .select({ id: tables.person.id })
    .from(tables.person)
    .where(eq(tables.person.displayName, displayName))
    .limit(1);
  const found = existing[0]?.id;
  if (found) return found;
  const inserted = await tx
    .insert(tables.person)
    .values({ organizationId: actor.organizationId, kind: "natural", displayName })
    .returning({ id: tables.person.id });
  return inserted[0]?.id ?? null;
}

type MovementDraft = { kind: BookingMovementKind; value: string; isThirdPartyTax?: boolean };

async function writeMovements(
  tx: Tx,
  actor: Actor,
  bookingId: string,
  occurredOn: string,
  currency: string,
  drafts: MovementDraft[],
  externalReference: string | null,
): Promise<number> {
  const rows = drafts
    .filter((draft) => draft.value !== ZERO)
    .map((draft) => ({
      organizationId: actor.organizationId,
      bookingId,
      kind: draft.kind,
      amount: draft.value,
      currency,
      occurredOn,
      isThirdPartyTax: draft.isThirdPartyTax ?? false,
      externalReference,
    }));
  if (rows.length === 0) return 0;
  await tx.insert(tables.bookingMovement).values(rows);
  return rows.length;
}

function movementDrafts(amounts: {
  accommodation: string;
  cleaning: string;
  commission: string;
  refund: string;
  touristTaxCollected: string;
  touristTaxRemitted: string;
}): MovementDraft[] {
  return [
    { kind: "accommodation", value: amounts.accommodation },
    { kind: "cleaning", value: amounts.cleaning },
    { kind: "commission", value: amounts.commission },
    { kind: "refund", value: amounts.refund },
    { kind: "tourist_tax_collected", value: amounts.touristTaxCollected, isThirdPartyTax: true },
    { kind: "tourist_tax_remitted", value: amounts.touristTaxRemitted, isThirdPartyTax: true },
  ];
}

export async function createBooking(
  tx: Tx,
  actor: Actor,
  input: CreateBookingInput,
): Promise<BookingDetail> {
  const listing = firstOr(
    await tx.select().from(tables.listing).where(eq(tables.listing.id, input.listingId)).limit(1),
    "Annonce",
  );
  if (input.checkOutOn <= input.checkInOn) {
    ruleViolation("Le départ doit suivre l’arrivée.");
  }
  const amounts = {
    accommodation: input.accommodationAmount ?? ZERO,
    cleaning: input.cleaningAmount ?? ZERO,
    commission: input.commissionAmount ?? ZERO,
    refund: input.refundAmount ?? ZERO,
    touristTaxCollected: input.touristTaxCollected ?? ZERO,
    touristTaxRemitted: input.touristTaxRemitted ?? ZERO,
  };
  const guestId = await guestPersonId(tx, actor, input.guestName ?? null);
  const inserted = await tx
    .insert(tables.booking)
    .values({
      organizationId: actor.organizationId,
      listingId: listing.id,
      unitId: listing.unitId,
      platform: listing.platform,
      externalBookingId: input.externalBookingId ?? null,
      guestPersonId: guestId,
      guestCount: input.guestCount ?? null,
      checkInOn: input.checkInOn,
      checkOutOn: input.checkOutOn,
      accommodationAmount: amounts.accommodation,
      cleaningAmount: amounts.cleaning,
      commissionAmount: amounts.commission,
      refundAmount: amounts.refund,
      touristTaxCollected: amounts.touristTaxCollected,
      touristTaxRemitted: amounts.touristTaxRemitted,
      depositAmount: input.depositAmount ?? ZERO,
      status: input.status ?? "confirmed",
      source: "manual",
    })
    .returning({ id: tables.booking.id });
  const id = inserted[0]?.id;
  if (!id) ruleViolation("La réservation n’a pas pu être créée.");
  await writeMovements(
    tx,
    actor,
    id,
    input.checkInOn,
    "EUR",
    movementDrafts(amounts),
    input.externalBookingId ?? null,
  );
  await recordFact(tx, actor, { kind: "booking", id, type: "booking.created" });
  await audit(tx, actor, { objectTable: "booking", objectId: id, action: "create", after: input });
  return getBooking(tx, id);
}

export async function updateBooking(
  tx: Tx,
  actor: Actor,
  input: UpdateBookingInput,
): Promise<BookingDetail> {
  const before = firstOr(
    await tx.select().from(tables.booking).where(eq(tables.booking.id, input.id)).limit(1),
    "Séjour",
  );
  if (before.version !== input.expectedVersion) versionConflict("La réservation");
  const checkInOn = input.checkInOn ?? before.checkInOn;
  const checkOutOn = input.checkOutOn ?? before.checkOutOn;
  if (checkOutOn <= checkInOn) ruleViolation("Le départ doit suivre l’arrivée.");

  const patch = {
    checkInOn,
    checkOutOn,
    ...(input.guestCount !== undefined ? { guestCount: input.guestCount } : {}),
    ...(input.accommodationAmount !== undefined
      ? { accommodationAmount: input.accommodationAmount }
      : {}),
    ...(input.cleaningAmount !== undefined ? { cleaningAmount: input.cleaningAmount } : {}),
    ...(input.commissionAmount !== undefined ? { commissionAmount: input.commissionAmount } : {}),
    ...(input.refundAmount !== undefined ? { refundAmount: input.refundAmount } : {}),
    ...(input.touristTaxCollected !== undefined
      ? { touristTaxCollected: input.touristTaxCollected }
      : {}),
    ...(input.touristTaxRemitted !== undefined
      ? { touristTaxRemitted: input.touristTaxRemitted }
      : {}),
    ...(input.depositAmount !== undefined ? { depositAmount: input.depositAmount } : {}),
  };
  await tx
    .update(tables.booking)
    .set({ ...patch, updatedAt: new Date().toISOString(), version: before.version + 1 })
    .where(eq(tables.booking.id, input.id));
  await audit(tx, actor, {
    objectTable: "booking",
    objectId: input.id,
    action: "update",
    before,
    after: patch,
  });
  return getBooking(tx, input.id);
}

export async function setBookingStatus(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number; status: BookingStatus },
): Promise<BookingDetail> {
  const before = firstOr(
    await tx.select().from(tables.booking).where(eq(tables.booking.id, input.id)).limit(1),
    "Séjour",
  );
  if (before.version !== input.expectedVersion) versionConflict("La réservation");
  const allowed = BOOKING_TRANSITIONS[before.status as BookingStatus] ?? [];
  if (!allowed.includes(input.status)) {
    ruleViolation("Cette réservation ne peut pas passer dans cet état.", {
      from: before.status,
      to: input.status,
    });
  }
  await tx
    .update(tables.booking)
    .set({
      status: input.status,
      updatedAt: new Date().toISOString(),
      version: before.version + 1,
    })
    .where(eq(tables.booking.id, input.id));
  await recordFact(tx, actor, {
    kind: "booking",
    id: input.id,
    type: "booking.status_changed",
    payload: { from: before.status, to: input.status },
  });
  await audit(tx, actor, {
    objectTable: "booking",
    objectId: input.id,
    action: "status",
    before: { status: before.status },
    after: { status: input.status },
  });
  return getBooking(tx, input.id);
}

export async function calendarFor(
  tx: Tx,
  input: { from: string; to: string; listingId?: string | undefined },
): Promise<CalendarRead> {
  const filters = [
    gte(tables.booking.checkOutOn, input.from),
    lte(tables.booking.checkInOn, input.to),
    input.listingId ? eq(tables.booking.listingId, input.listingId) : undefined,
  ].filter((clause) => clause !== undefined);

  const [rows, feeds] = await Promise.all([
    tx
      .select({
        id: tables.booking.id,
        listingId: tables.booking.listingId,
        listingLabel: sql<string>`coalesce(${tables.listing.title}, ${tables.unit.label})`,
        checkInOn: tables.booking.checkInOn,
        checkOutOn: tables.booking.checkOutOn,
        status: tables.booking.status,
        source: tables.booking.source,
        guestName: tables.person.displayName,
      })
      .from(tables.booking)
      .innerJoin(tables.listing, eq(tables.listing.id, tables.booking.listingId))
      .innerJoin(tables.unit, eq(tables.unit.id, tables.booking.unitId))
      .leftJoin(tables.person, eq(tables.person.id, tables.booking.guestPersonId))
      .where(and(...filters))
      .orderBy(asc(tables.booking.checkInOn)),
    tx
      .select({
        listingId: tables.listing.id,
        label: sql<string>`coalesce(${tables.listing.title}, ${tables.unit.label})`,
        lastPolledAt: tables.listing.icalLastPolledAt,
      })
      .from(tables.listing)
      .innerJoin(tables.unit, eq(tables.unit.id, tables.listing.unitId))
      .where(isNotNull(tables.listing.icalImportUrl)),
  ]);

  return {
    from: input.from,
    to: input.to,
    entries: rows.map((row) => ({
      bookingId: row.id,
      listingId: row.listingId,
      listingLabel: row.listingLabel,
      startsOn: row.checkInOn,
      endsOn: addDays(row.checkOutOn, -1),
      nights: nights(row.checkInOn, row.checkOutOn),
      status: row.status as BookingStatus,
      source: row.source as CalendarRead["entries"][number]["source"],
      label: row.guestName,
    })),
    feeds: feeds.map((feed) => ({
      listingId: feed.listingId,
      label: feed.label,
      lastPolledAt: instant(feed.lastPolledAt),
      ...staleness(instant(feed.lastPolledAt)),
    })),
  };
}

async function planFromFile(
  tx: Tx,
  input: { mappingVersion: string; content: string; declaredTotal?: string | undefined },
): Promise<ImportPlan> {
  const mapping = resolveMapping(input.mappingVersion);
  const table = parseCsv(input.content);
  const known = await tx
    .select({
      id: tables.booking.id,
      externalBookingId: tables.booking.externalBookingId,
      accommodationAmount: tables.booking.accommodationAmount,
      cleaningAmount: tables.booking.cleaningAmount,
      commissionAmount: tables.booking.commissionAmount,
      refundAmount: tables.booking.refundAmount,
      touristTaxCollected: tables.booking.touristTaxCollected,
      touristTaxRemitted: tables.booking.touristTaxRemitted,
    })
    .from(tables.booking)
    .where(isNotNull(tables.booking.externalBookingId));
  const knownPayouts = await tx
    .select({ externalPayoutId: tables.payout.externalPayoutId })
    .from(tables.payout)
    .where(isNotNull(tables.payout.externalPayoutId));

  const knownBookings = new Map<string, KnownBooking>();
  for (const row of known) {
    if (!row.externalBookingId) continue;
    knownBookings.set(row.externalBookingId, {
      id: row.id,
      externalBookingId: row.externalBookingId,
      accommodation: amount(row.accommodationAmount),
      cleaning: amount(row.cleaningAmount),
      extras: ZERO,
      commission: amount(row.commissionAmount),
      refunds: amount(row.refundAmount),
      taxCollected: amount(row.touristTaxCollected),
      taxRemitted: amount(row.touristTaxRemitted),
    });
  }

  return planImport({
    mapping,
    table,
    context: {
      knownBookings,
      knownPayoutIds: new Set(
        knownPayouts.map((row) => row.externalPayoutId).filter((id): id is string => id !== null),
      ),
      declaredTotal: input.declaredTotal,
    },
  });
}

export async function previewImport(
  tx: Tx,
  input: { mappingVersion: string; content: string; declaredTotal?: string | undefined },
): Promise<ImportPreview> {
  const plan = await planFromFile(tx, input);
  const duplicates =
    plan.mapping.kind === "bookings"
      ? plan.bookings.filter((booking) => booking.duplicate).length
      : plan.payouts.filter((payout) => payout.duplicate).length;
  const rowCount = plan.mapping.kind === "bookings" ? plan.bookings.length : plan.payouts.length;
  return {
    mappingVersion: plan.mapping.version,
    kind: plan.mapping.kind,
    delimiter: plan.delimiter,
    headers: plan.headers,
    mappedColumns: plan.mappedColumns,
    missingColumns: plan.missingColumns,
    unknownColumns: plan.unknownColumns,
    rowCount,
    newCount: rowCount - duplicates,
    duplicateCount: duplicates,
    rows: plan.previewRows,
    issues: plan.issues,
    totals: plan.totals,
    payouts: plan.payouts.map((payout) => payout.reconciliation),
    blocked: plan.blocked,
    blockedReasons: plan.blockedReasons,
  };
}

export async function commitImport(
  tx: Tx,
  actor: Actor,
  input: {
    mappingVersion: string;
    content: string;
    listingId?: string | undefined;
    legalEntityId?: string | undefined;
    declaredTotal?: string | undefined;
  },
): Promise<ImportResult> {
  const plan = await planFromFile(tx, input);
  if (plan.blocked) {
    ruleViolation("Corrigez le fichier avant de l’importer.", { reasons: plan.blockedReasons });
  }

  const result: ImportResult = {
    mappingVersion: plan.mapping.version,
    kind: plan.mapping.kind,
    bookingsCreated: 0,
    payoutsCreated: 0,
    movementsCreated: 0,
    detailsCreated: 0,
    skippedDuplicates: 0,
    varianceCount: 0,
  };

  const bookingIdByReference = new Map<string, string>();
  if (plan.mapping.kind === "bookings") {
    const listingId = input.listingId;
    if (!listingId) ruleViolation("Choisissez l’annonce à laquelle rattacher ces réservations.");
    const listing = firstOr(
      await tx.select().from(tables.listing).where(eq(tables.listing.id, listingId)).limit(1),
      "Annonce",
    );
    result.skippedDuplicates = plan.bookings.length - newBookings(plan).length;

    for (const booking of newBookings(plan)) {
      const guestId = await guestPersonId(tx, actor, booking.guestName);
      // The unique key carries the idempotence: a second import of the same file
      // conflicts on (organization, platform, external id) and writes nothing.
      const inserted = await tx
        .insert(tables.booking)
        .values({
          organizationId: actor.organizationId,
          listingId: listing.id,
          unitId: listing.unitId,
          platform: listing.platform,
          externalBookingId: booking.externalBookingId,
          guestPersonId: guestId,
          guestCount: booking.guestCount,
          checkInOn: booking.checkInOn,
          checkOutOn: booking.checkOutOn,
          accommodationAmount: booking.amounts.accommodation,
          cleaningAmount: booking.amounts.cleaning,
          commissionAmount: booking.amounts.commission,
          refundAmount: booking.amounts.refund,
          touristTaxCollected: booking.amounts.touristTaxCollected,
          touristTaxRemitted: booking.amounts.touristTaxRemitted,
          depositAmount: booking.amounts.deposit,
          currency: booking.currency,
          status: booking.status,
          source: "file_import",
        })
        .onConflictDoNothing()
        .returning({ id: tables.booking.id });
      const id = inserted[0]?.id;
      if (!id) {
        result.skippedDuplicates += 1;
        continue;
      }
      bookingIdByReference.set(booking.externalBookingId, id);
      result.bookingsCreated += 1;
      result.movementsCreated += await writeMovements(
        tx,
        actor,
        id,
        booking.checkInOn,
        booking.currency,
        movementDrafts(booking.amounts),
        booking.externalBookingId,
      );
      await recordFact(tx, actor, { kind: "booking", id, type: "booking.imported" });
    }
  }

  const legalEntityId = input.legalEntityId;
  for (const payout of newPayouts(plan)) {
    if (!legalEntityId) ruleViolation("Choisissez la SCI qui reçoit ces versements.");
    const inserted = await tx
      .insert(tables.payout)
      .values({
        organizationId: actor.organizationId,
        legalEntityId,
        platform: plan.mapping.platform,
        externalPayoutId: payout.externalPayoutId,
        paidOn: payout.paidOn,
        netAmount: payout.declaredNet,
        currency: payout.currency,
        importMappingVersion: plan.mapping.version,
        status: payout.reconciliation.matched ? "matched" : "variance",
        varianceAmount: payout.reconciliation.difference,
      })
      .onConflictDoNothing()
      .returning({ id: tables.payout.id });
    const payoutId = inserted[0]?.id;
    if (!payoutId) {
      result.skippedDuplicates += 1;
      continue;
    }
    result.payoutsCreated += 1;
    if (!payout.reconciliation.matched) result.varianceCount += 1;

    const details = payout.lines.map((line) => ({
      organizationId: actor.organizationId,
      payoutId,
      bookingId:
        line.bookingExternalId === null
          ? null
          : (bookingIdByReference.get(line.bookingExternalId) ?? line.knownBookingId),
      bookingMovementId: null,
      label: line.label ?? line.reference,
      amount: line.amount,
      currency: payout.currency,
    }));
    if (details.length > 0) {
      await tx.insert(tables.payoutDetail).values(details);
      result.detailsCreated += details.length;
    }
    await audit(tx, actor, {
      objectTable: "payout",
      objectId: payoutId,
      action: "import",
      after: {
        mappingVersion: plan.mapping.version,
        declaredNet: payout.declaredNet,
        difference: payout.reconciliation.difference,
      },
    });
  }

  return result;
}

export function availableMappings(kind?: string) {
  return {
    items: IMPORT_MAPPINGS.filter((mapping) => kind === undefined || mapping.kind === kind).map(
      describeMapping,
    ),
  };
}

const payoutColumns = {
  id: tables.payout.id,
  platform: tables.payout.platform,
  externalPayoutId: tables.payout.externalPayoutId,
  legalEntityId: tables.payout.legalEntityId,
  legalEntityName: tables.legalEntity.name,
  paidOn: tables.payout.paidOn,
  netAmount: tables.payout.netAmount,
  currency: tables.payout.currency,
  status: tables.payout.status,
  varianceAmount: tables.payout.varianceAmount,
  importMappingVersion: tables.payout.importMappingVersion,
  createdAt: tables.payout.createdAt,
  version: tables.payout.version,
  detailCount: sql<number>`(
    SELECT count(*)::int FROM payout_detail pd WHERE pd.payout_id = ${tables.payout.id}
  )`,
};

type PayoutSelected = Awaited<ReturnType<typeof selectPayouts>>[number];

function selectPayouts(tx: Tx) {
  return tx
    .select(payoutColumns)
    .from(tables.payout)
    .innerJoin(tables.legalEntity, eq(tables.legalEntity.id, tables.payout.legalEntityId));
}

function mapPayout(row: PayoutSelected): PayoutRow {
  return {
    id: row.id,
    platform: row.platform as PayoutRow["platform"],
    externalPayoutId: row.externalPayoutId,
    legalEntityId: row.legalEntityId,
    legalEntityName: row.legalEntityName,
    paidOn: row.paidOn,
    netAmount: amount(row.netAmount),
    currency: row.currency,
    status: row.status as PayoutRow["status"],
    varianceAmount: amount(row.varianceAmount),
    importMappingVersion: row.importMappingVersion,
    detailCount: row.detailCount,
    version: row.version,
  };
}

export async function listPayouts(
  tx: Tx,
  input: {
    cursor?: string | undefined;
    limit?: number | undefined;
    status?: string | undefined;
    platform?: string | undefined;
  },
): Promise<{ items: PayoutRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const filters = [
    input.status ? eq(tables.payout.status, input.status) : undefined,
    input.platform ? eq(tables.payout.platform, input.platform) : undefined,
  ].filter((clause) => clause !== undefined);

  const rows = await selectPayouts(tx)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(tables.payout.paidOn))
    .limit(limit + 1)
    .offset(offset);

  return {
    items: rows.slice(0, limit).map(mapPayout),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

export async function getPayout(tx: Tx, id: string): Promise<PayoutDetailRead> {
  const row = firstOr(
    await selectPayouts(tx).where(eq(tables.payout.id, id)).limit(1),
    "Versement",
  );
  const details = await tx
    .select({
      id: tables.payoutDetail.id,
      label: tables.payoutDetail.label,
      amount: tables.payoutDetail.amount,
      currency: tables.payoutDetail.currency,
      bookingId: tables.payoutDetail.bookingId,
      movementKind: tables.bookingMovement.kind,
    })
    .from(tables.payoutDetail)
    .leftJoin(
      tables.bookingMovement,
      eq(tables.bookingMovement.id, tables.payoutDetail.bookingMovementId),
    )
    .where(eq(tables.payoutDetail.payoutId, id))
    .orderBy(asc(tables.payoutDetail.createdAt));

  const bookingIds = details
    .map((detail) => detail.bookingId)
    .filter((bookingId): bookingId is string => bookingId !== null);
  const bookings =
    bookingIds.length === 0
      ? []
      : await tx
          .select({
            id: tables.booking.id,
            externalBookingId: tables.booking.externalBookingId,
            accommodationAmount: tables.booking.accommodationAmount,
            cleaningAmount: tables.booking.cleaningAmount,
            commissionAmount: tables.booking.commissionAmount,
            refundAmount: tables.booking.refundAmount,
            touristTaxCollected: tables.booking.touristTaxCollected,
            touristTaxRemitted: tables.booking.touristTaxRemitted,
          })
          .from(tables.booking)
          .where(inArray(tables.booking.id, bookingIds));
  const referenceById = new Map(
    bookings.map((booking) => [booking.id, booking.externalBookingId ?? booking.id]),
  );

  const reconciliation = reconciliationOf({
    externalPayoutId: row.externalPayoutId,
    paidOn: row.paidOn,
    currency: row.currency,
    declaredNet: amount(row.netAmount),
    bookings: bookings.map((booking) => ({
      reference: referenceById.get(booking.id) ?? booking.id,
      bookingId: booking.id,
      booking: {
        bookingId: referenceById.get(booking.id) ?? booking.id,
        accommodation: amount(booking.accommodationAmount),
        cleaning: amount(booking.cleaningAmount),
        refunds: amount(booking.refundAmount),
        commission: amount(booking.commissionAmount),
        taxCollected: amount(booking.touristTaxCollected),
        taxRemitted: amount(booking.touristTaxRemitted),
      },
    })),
    adjustments: details
      .filter((detail) => detail.bookingId === null)
      .map((detail) => ({
        reference: detail.label ?? detail.id,
        kind: "other_period" as const,
        amount: amount(detail.amount),
        label: detail.label ?? undefined,
      })),
    unexplained: [],
  });

  return {
    ...mapPayout(row),
    createdAt: instantOrNow(row.createdAt),
    details: details.map((detail) => ({
      id: detail.id,
      label: detail.label,
      amount: amount(detail.amount),
      currency: detail.currency,
      bookingId: detail.bookingId,
      bookingReference: detail.bookingId ? (referenceById.get(detail.bookingId) ?? null) : null,
      movementKind: detail.movementKind as BookingMovementKind | null,
    })),
    reconciliation,
  };
}

export async function decidePayout(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number; decision: "confirm" | "reject" },
): Promise<PayoutDetailRead> {
  const before = firstOr(
    await tx.select().from(tables.payout).where(eq(tables.payout.id, input.id)).limit(1),
    "Versement",
  );
  if (before.version !== input.expectedVersion) versionConflict("Le versement");
  // F04: an unexplained difference blocks the confirmation instead of being
  // absorbed into the accounts.
  if (input.decision === "confirm" && amount(before.varianceAmount) !== ZERO) {
    ruleViolation("Un écart non expliqué doit être levé avant de confirmer ce versement.", {
      variance: amount(before.varianceAmount),
    });
  }
  await tx
    .update(tables.payout)
    .set({
      status: input.decision === "confirm" ? "confirmed" : "rejected",
      updatedAt: new Date().toISOString(),
      version: before.version + 1,
    })
    .where(eq(tables.payout.id, input.id));
  await audit(tx, actor, {
    objectTable: "payout",
    objectId: input.id,
    action: input.decision,
    before: { status: before.status },
    after: { status: input.decision === "confirm" ? "confirmed" : "rejected" },
  });
  return getPayout(tx, input.id);
}
