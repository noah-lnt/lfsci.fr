import "server-only";
import type { BookingStatus } from "@lfsci/contracts";
import {
  bookingLine,
  type Booking as DomainBooking,
  decimal,
  type PayoutAdjustment,
  reconcileGroupedPayout,
  toMoney,
} from "@lfsci/domain";
import type {
  ImportPreviewRow,
  ImportRowIssue,
  ReconciliationRead,
} from "@/lib/contracts/courte-duree";
import type { CsvTable } from "./csv";
import {
  type ImportMapping,
  type MappedRow,
  mapTable,
  parseCivilDate,
  parseInteger,
  parseMoney,
} from "./mapping";

const ZERO = "0.00";
const PREVIEW_LIMIT = 200;

export type PlannedBookingAmounts = {
  accommodation: string;
  cleaning: string;
  commission: string;
  refund: string;
  touristTaxCollected: string;
  touristTaxRemitted: string;
  deposit: string;
};

export type PlannedBooking = {
  line: number;
  externalBookingId: string;
  listingExternalId: string | null;
  checkInOn: string;
  checkOutOn: string;
  nights: number;
  guestName: string | null;
  guestCount: number | null;
  currency: string;
  status: BookingStatus;
  amounts: PlannedBookingAmounts;
  payoutReference: string | null;
  net: string;
  duplicate: boolean;
  duplicateReason: "already_imported" | "duplicate_in_file" | null;
};

export type PlannedPayoutLine = {
  reference: string;
  bookingExternalId: string | null;
  knownBookingId: string | null;
  amount: string;
  label: string | null;
};

export type PlannedPayout = {
  externalPayoutId: string;
  paidOn: string;
  currency: string;
  declaredNet: string;
  reconciliation: ReconciliationRead;
  lines: PlannedPayoutLine[];
  bookingReferences: string[];
  duplicate: boolean;
  duplicateReason: "already_imported" | "duplicate_in_file" | null;
};

export type KnownBooking = {
  id: string;
  externalBookingId: string;
  accommodation: string;
  cleaning: string;
  extras: string;
  commission: string;
  refunds: string;
  taxCollected: string;
  taxRemitted: string;
};

export type PlanContext = {
  knownBookings: Map<string, KnownBooking>;
  knownPayoutIds: Set<string>;
  declaredTotal?: string | undefined;
};

export type ImportPlan = {
  mapping: ImportMapping;
  delimiter: string;
  headers: string[];
  mappedColumns: { field: string; header: string }[];
  missingColumns: string[];
  unknownColumns: string[];
  bookings: PlannedBooking[];
  payouts: PlannedPayout[];
  issues: ImportRowIssue[];
  previewRows: ImportPreviewRow[];
  totals: {
    declared: string | null;
    computed: string;
    difference: string | null;
    matched: boolean;
  };
  blocked: boolean;
  blockedReasons: string[];
};

function sumMoney(values: readonly string[]): string {
  return toMoney(values.reduce((acc, value) => acc.plus(decimal(value)), decimal("0")));
}

function nightsBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function domainBooking(reference: string, amounts: PlannedBookingAmounts): DomainBooking {
  return {
    bookingId: reference,
    accommodation: amounts.accommodation,
    cleaning: amounts.cleaning,
    refunds: amounts.refund,
    commission: amounts.commission,
    taxCollected: amounts.touristTaxCollected,
    taxRemitted: amounts.touristTaxRemitted,
  };
}

function knownToDomain(known: KnownBooking): DomainBooking {
  return {
    bookingId: known.externalBookingId,
    accommodation: known.accommodation,
    cleaning: known.cleaning,
    otherServices: known.extras,
    refunds: known.refunds,
    commission: known.commission,
    taxCollected: known.taxCollected,
    taxRemitted: known.taxRemitted,
  };
}

export function reconciliationOf(input: {
  externalPayoutId: string | null;
  paidOn: string;
  currency: string;
  declaredNet: string;
  bookings: { reference: string; booking: DomainBooking; bookingId: string | null }[];
  adjustments: PayoutAdjustment[];
  unexplained: { reference: string; amount: string; reason: string }[];
}): ReconciliationRead {
  const grouped = reconcileGroupedPayout({
    bookings: input.bookings.map((entry) => entry.booking),
    adjustments: input.adjustments,
    declaredNet: input.declaredNet,
  });
  const byReference = new Map(input.bookings.map((entry) => [entry.booking.bookingId, entry]));
  return {
    externalPayoutId: input.externalPayoutId,
    paidOn: input.paidOn,
    currency: input.currency,
    declaredNet: grouped.declaredNet,
    bookingNet: grouped.bookingNet,
    adjustmentTotal: grouped.adjustmentTotal,
    expectedNet: grouped.expectedNet,
    difference: grouped.difference,
    matched: grouped.matched,
    grossServices: grouped.expectation.grossServices,
    refunds: grouped.expectation.refunds,
    commissions: grouped.expectation.commissions,
    taxCollected: grouped.expectation.taxCollected,
    taxRemitted: grouped.expectation.taxRemitted,
    taxFlow: grouped.expectation.taxFlow,
    revenueRecognised: grouped.expectation.revenueRecognised,
    lines: grouped.expectation.bookings.map((line) => ({
      reference: line.bookingId,
      bookingId: byReference.get(line.bookingId)?.bookingId ?? null,
      grossServices: line.grossServices,
      refunds: line.refunds,
      commission: line.commission,
      taxFlow: line.taxFlow,
      net: line.net,
      known: (byReference.get(line.bookingId)?.bookingId ?? null) !== null,
    })),
    adjustments: grouped.adjustments.map((adjustment) => ({
      reference: adjustment.reference,
      kind: adjustment.kind,
      amount: adjustment.amount,
      label: adjustment.label ?? null,
    })),
    unexplained: input.unexplained,
  };
}

type RowReader = {
  row: MappedRow;
  issues: ImportRowIssue[];
  mapping: ImportMapping;
};

function text(reader: RowReader, field: string, required: boolean): string | null {
  const raw = reader.row.values.get(field);
  if (raw === undefined || raw === "") {
    if (required) {
      reader.issues.push({ line: reader.row.line, field, message: "valeur manquante" });
    }
    return null;
  }
  return raw;
}

function date(reader: RowReader, field: string, required: boolean): string | null {
  const raw = text(reader, field, required);
  if (raw === null) return null;
  const parsed = parseCivilDate(raw, reader.mapping.dateOrder);
  if (parsed === null) {
    reader.issues.push({ line: reader.row.line, field, message: `date illisible : ${raw}` });
  }
  return parsed;
}

function money(reader: RowReader, field: string, required: boolean): string | null {
  const raw = text(reader, field, required);
  if (raw === null) return null;
  const parsed = parseMoney(raw, reader.mapping.decimalMark);
  if (parsed === null) {
    reader.issues.push({ line: reader.row.line, field, message: `montant illisible : ${raw}` });
  }
  return parsed;
}

function planBookings(
  mapping: ImportMapping,
  rows: MappedRow[],
  context: PlanContext,
  issues: ImportRowIssue[],
): { bookings: PlannedBooking[]; payouts: PlannedPayout[] } {
  const seen = new Set<string>();
  const bookings: PlannedBooking[] = [];

  for (const row of rows) {
    if (row.values.size === 0) continue;
    const reader: RowReader = { row, issues, mapping };
    const reference = text(reader, "externalBookingId", true);
    const checkInOn = date(reader, "checkInOn", true);
    const checkOutOn = date(reader, "checkOutOn", true);
    const accommodation = money(reader, "accommodationAmount", true);
    if (reference === null || checkInOn === null || checkOutOn === null || accommodation === null) {
      continue;
    }
    if (checkOutOn <= checkInOn) {
      issues.push({
        line: row.line,
        field: "checkOutOn",
        message: "le départ doit suivre l’arrivée",
      });
      continue;
    }
    const amounts: PlannedBookingAmounts = {
      accommodation,
      cleaning: money(reader, "cleaningAmount", false) ?? ZERO,
      commission: money(reader, "commissionAmount", false) ?? ZERO,
      refund: money(reader, "refundAmount", false) ?? ZERO,
      touristTaxCollected: money(reader, "touristTaxCollected", false) ?? ZERO,
      touristTaxRemitted: money(reader, "touristTaxRemitted", false) ?? ZERO,
      deposit: money(reader, "depositAmount", false) ?? ZERO,
    };
    const duplicateReason = seen.has(reference)
      ? ("duplicate_in_file" as const)
      : context.knownBookings.has(reference)
        ? ("already_imported" as const)
        : null;
    seen.add(reference);
    const currency = (row.values.get("currency") ?? "EUR").slice(0, 3).toUpperCase();
    bookings.push({
      line: row.line,
      externalBookingId: reference,
      listingExternalId: row.values.get("listingExternalId") ?? null,
      checkInOn,
      checkOutOn,
      nights: nightsBetween(checkInOn, checkOutOn),
      guestName: row.values.get("guestName") ?? null,
      guestCount: parseInteger(row.values.get("guestCount") ?? ""),
      currency,
      status: "confirmed",
      amounts,
      payoutReference: row.values.get("payoutReference") ?? null,
      net: bookingLine(domainBooking(reference, amounts)).net,
      duplicate: duplicateReason !== null,
      duplicateReason,
    });
  }

  const groups = new Map<string, PlannedBooking[]>();
  for (const booking of bookings) {
    if (booking.payoutReference === null) continue;
    const bucket = groups.get(booking.payoutReference) ?? [];
    bucket.push(booking);
    groups.set(booking.payoutReference, bucket);
  }

  const payouts: PlannedPayout[] = [];
  for (const [reference, group] of groups) {
    const withNet = rows.find(
      (row) =>
        row.values.get("payoutReference") === reference &&
        row.values.get("payoutNetAmount") !== undefined,
    );
    const declaredRaw = withNet?.values.get("payoutNetAmount");
    if (declaredRaw === undefined) continue;
    const declaredNet = parseMoney(declaredRaw, mapping.decimalMark);
    const paidOnRaw = withNet?.values.get("payoutPaidOn");
    const paidOn = paidOnRaw === undefined ? null : parseCivilDate(paidOnRaw, mapping.dateOrder);
    if (declaredNet === null || paidOn === null) {
      issues.push({
        line: withNet?.line ?? 0,
        field: "payoutNetAmount",
        message: "le versement groupé exige une date et un montant lisibles",
      });
      continue;
    }
    const first = group[0];
    payouts.push({
      externalPayoutId: reference,
      paidOn,
      currency: first?.currency ?? "EUR",
      declaredNet,
      lines: group.map((booking) => ({
        reference: booking.externalBookingId,
        bookingExternalId: booking.externalBookingId,
        knownBookingId: context.knownBookings.get(booking.externalBookingId)?.id ?? null,
        amount: booking.net,
        label: booking.guestName,
      })),
      bookingReferences: group.map((booking) => booking.externalBookingId),
      duplicate: context.knownPayoutIds.has(reference),
      duplicateReason: context.knownPayoutIds.has(reference) ? "already_imported" : null,
      reconciliation: reconciliationOf({
        externalPayoutId: reference,
        paidOn,
        currency: first?.currency ?? "EUR",
        declaredNet,
        bookings: group.map((booking) => ({
          reference: booking.externalBookingId,
          bookingId: context.knownBookings.get(booking.externalBookingId)?.id ?? null,
          booking: domainBooking(booking.externalBookingId, booking.amounts),
        })),
        adjustments: [],
        unexplained: [],
      }),
    });
  }

  return { bookings, payouts };
}

function adjustmentKindOf(raw: string | undefined): PayoutAdjustment["kind"] {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("reten") || value.includes("withh")) return "retention";
  if (value.includes("correct")) return "correction";
  return "other_period";
}

function planPayouts(
  mapping: ImportMapping,
  rows: MappedRow[],
  context: PlanContext,
  issues: ImportRowIssue[],
): PlannedPayout[] {
  type Group = {
    paidOn: string;
    currency: string;
    declaredNet: string;
    lines: PlannedPayoutLine[];
    bookings: { reference: string; bookingId: string | null; booking: DomainBooking }[];
    adjustments: PayoutAdjustment[];
    unexplained: { reference: string; amount: string; reason: string }[];
  };
  const groups = new Map<string, Group>();

  for (const row of rows) {
    if (row.values.size === 0) continue;
    const reader: RowReader = { row, issues, mapping };
    const reference = text(reader, "externalPayoutId", true);
    const paidOn = date(reader, "paidOn", true);
    const declaredNet = money(reader, "netAmount", true);
    if (reference === null || paidOn === null || declaredNet === null) continue;

    const currency = (row.values.get("currency") ?? "EUR").slice(0, 3).toUpperCase();
    const group = groups.get(reference) ?? {
      paidOn,
      currency,
      declaredNet,
      lines: [],
      bookings: [],
      adjustments: [],
      unexplained: [],
    };
    if (group.declaredNet !== declaredNet) {
      issues.push({
        line: row.line,
        field: "netAmount",
        message: "le montant du versement change d’une ligne à l’autre",
      });
    }
    const lineAmount = money(reader, "lineAmount", false);
    const label = row.values.get("label") ?? null;
    const bookingReference = row.values.get("bookingReference") ?? null;

    if (bookingReference !== null) {
      const known = context.knownBookings.get(bookingReference);
      if (known) {
        group.bookings.push({
          reference: bookingReference,
          bookingId: known.id,
          booking: knownToDomain(known),
        });
      } else {
        group.unexplained.push({
          reference: bookingReference,
          amount: lineAmount ?? ZERO,
          reason: "booking_unknown",
        });
      }
      group.lines.push({
        reference: bookingReference,
        bookingExternalId: bookingReference,
        knownBookingId: known?.id ?? null,
        amount: lineAmount ?? ZERO,
        label,
      });
    } else if (lineAmount !== null) {
      const adjustmentReference = label ?? `${reference}-L${row.line}`;
      group.adjustments.push({
        reference: adjustmentReference,
        kind: adjustmentKindOf(row.values.get("lineKind")),
        amount: lineAmount,
        label: label ?? undefined,
      });
      group.lines.push({
        reference: adjustmentReference,
        bookingExternalId: null,
        knownBookingId: null,
        amount: lineAmount,
        label,
      });
    }
    groups.set(reference, group);
  }

  return [...groups].map(([reference, group]) => ({
    externalPayoutId: reference,
    paidOn: group.paidOn,
    currency: group.currency,
    declaredNet: group.declaredNet,
    lines: group.lines,
    bookingReferences: group.bookings.map((entry) => entry.reference),
    duplicate: context.knownPayoutIds.has(reference),
    duplicateReason: context.knownPayoutIds.has(reference) ? "already_imported" : null,
    reconciliation: reconciliationOf({
      externalPayoutId: reference,
      paidOn: group.paidOn,
      currency: group.currency,
      declaredNet: group.declaredNet,
      bookings: group.bookings,
      adjustments: group.adjustments,
      unexplained: group.unexplained,
    }),
  }));
}

export function planImport(input: {
  mapping: ImportMapping;
  table: CsvTable;
  context: PlanContext;
}): ImportPlan {
  const mapped = mapTable(input.mapping, input.table);
  const issues: ImportRowIssue[] = [];
  const isBookings = input.mapping.kind === "bookings";
  const planned = isBookings
    ? planBookings(input.mapping, mapped.rows, input.context, issues)
    : { bookings: [] as PlannedBooking[], payouts: [] as PlannedPayout[] };
  const payouts = isBookings
    ? planned.payouts
    : planPayouts(input.mapping, mapped.rows, input.context, issues);

  const computed = isBookings
    ? sumMoney(planned.bookings.map((booking) => booking.net))
    : sumMoney(payouts.map((payout) => payout.declaredNet));
  const declared = input.context.declaredTotal ?? null;
  const difference = declared === null ? null : toMoney(decimal(declared).minus(decimal(computed)));

  const blockedReasons: string[] = [];
  if (mapped.missingColumns.length > 0) blockedReasons.push("missing_columns");
  if (issues.length > 0) blockedReasons.push("rows_in_error");
  if (isBookings && planned.bookings.length === 0) blockedReasons.push("no_rows");
  if (!isBookings && payouts.length === 0) blockedReasons.push("no_rows");
  if (difference !== null && difference !== ZERO) blockedReasons.push("total_mismatch");

  const previewRows: ImportPreviewRow[] = isBookings
    ? planned.bookings.slice(0, PREVIEW_LIMIT).map((booking) => ({
        line: booking.line,
        reference: booking.externalBookingId,
        checkInOn: booking.checkInOn,
        checkOutOn: booking.checkOutOn,
        nights: booking.nights,
        guestName: booking.guestName,
        net: booking.net,
        duplicate: booking.duplicate,
        duplicateReason: booking.duplicateReason,
      }))
    : payouts.slice(0, PREVIEW_LIMIT).map((payout) => ({
        line: 0,
        reference: payout.externalPayoutId,
        checkInOn: null,
        checkOutOn: null,
        nights: null,
        guestName: null,
        net: payout.declaredNet,
        duplicate: payout.duplicate,
        duplicateReason: payout.duplicateReason,
      }));

  return {
    mapping: input.mapping,
    delimiter: input.table.delimiter,
    headers: input.table.headers,
    mappedColumns: mapped.mappedColumns,
    missingColumns: mapped.missingColumns,
    unknownColumns: mapped.unknownColumns,
    bookings: planned.bookings,
    payouts,
    issues,
    previewRows,
    totals: {
      declared,
      computed,
      difference,
      matched: difference === null || difference === ZERO,
    },
    blocked: blockedReasons.length > 0,
    blockedReasons,
  };
}

/** What a commit writes: the rows the platform identifiers do not already cover. */
export function newBookings(plan: ImportPlan): PlannedBooking[] {
  return plan.bookings.filter((booking) => !booking.duplicate);
}

export function newPayouts(plan: ImportPlan): PlannedPayout[] {
  return plan.payouts.filter((payout) => !payout.duplicate);
}
