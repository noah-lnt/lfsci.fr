import {
  BookingMovementKind,
  BookingSource,
  BookingStatus,
  Currency,
  Cursor,
  IsoDate,
  IsoDateTime,
  ListingPlatform,
  ListingStatus,
  Money,
  Page,
  PayoutStatus,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: Cursor.nullable() });

const listInput = <T extends z.ZodRawShape>(filters: T) =>
  z.strictObject({ ...Page.shape, ...filters });

export const Option = z.object({ id: Uuid, label: z.string() });
export type Option = z.infer<typeof Option>;

export const CourteDureeLookups = z.object({
  units: z.array(Option),
  legalEntities: z.array(Option),
  listings: z.array(Option.extend({ platform: ListingPlatform, status: ListingStatus })),
});
export type CourteDureeLookups = z.infer<typeof CourteDureeLookups>;

export const ListingRow = z.object({
  id: Uuid,
  unitId: Uuid,
  unitLabel: z.string(),
  buildingName: z.string().nullable(),
  platform: ListingPlatform,
  externalListingId: z.string().nullable(),
  title: z.string().nullable(),
  status: ListingStatus,
  icalImportUrl: z.string().nullable(),
  icalExportUrl: z.string().nullable(),
  icalLastPolledAt: IsoDateTime.nullable(),
  registrationNumber: z.string().nullable(),
  registrationCheckedOn: IsoDate.nullable(),
  bookingCount: z.number().int(),
  nextCheckInOn: IsoDate.nullable(),
  version: Version,
});
export type ListingRow = z.infer<typeof ListingRow>;

/** AIR-03: where a block comes from, so a calendar aid is never read as evidence. */
export const AvailabilityBlockRead = z.object({
  reference: z.string(),
  bookingId: Uuid.nullable(),
  startsOn: IsoDate,
  endsOn: IsoDate,
  nights: z.number().int(),
  label: z.string().nullable(),
  source: BookingSource,
});
export type AvailabilityBlockRead = z.infer<typeof AvailabilityBlockRead>;

export const AvailabilityRead = z.object({
  listingId: Uuid,
  icalImportUrl: z.string().nullable(),
  lastPolledAt: IsoDateTime.nullable(),
  neverPolled: z.boolean(),
  /** True past the refresh window the platform documents: the feed may lag. */
  stale: z.boolean(),
  blocks: z.array(AvailabilityBlockRead),
});
export type AvailabilityRead = z.infer<typeof AvailabilityRead>;

export const ListingDetail = ListingRow.extend({
  createdAt: IsoDateTime,
  availability: AvailabilityRead,
});
export type ListingDetail = z.infer<typeof ListingDetail>;

export const CreateListingInput = z.strictObject({
  unitId: Uuid,
  platform: ListingPlatform,
  title: z.string().min(1).optional(),
  externalListingId: z.string().min(1).optional(),
  icalImportUrl: z.url().optional(),
  icalExportUrl: z.url().optional(),
  registrationNumber: z.string().min(1).optional(),
  registrationCheckedOn: IsoDate.optional(),
  status: ListingStatus.optional(),
});
export type CreateListingInput = z.infer<typeof CreateListingInput>;

export const UpdateListingInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  title: z.string().min(1).nullable().optional(),
  externalListingId: z.string().min(1).nullable().optional(),
  icalImportUrl: z.url().nullable().optional(),
  icalExportUrl: z.url().nullable().optional(),
  registrationNumber: z.string().min(1).nullable().optional(),
  registrationCheckedOn: IsoDate.nullable().optional(),
});
export type UpdateListingInput = z.infer<typeof UpdateListingInput>;

/** A stay is the occupancy: dates, nights and guests, no amount. */
export const StayRead = z.object({
  unitId: Uuid,
  unitLabel: z.string(),
  buildingName: z.string().nullable(),
  checkInOn: IsoDate,
  checkOutOn: IsoDate,
  nights: z.number().int(),
  guestCount: z.number().int().nullable(),
  guestName: z.string().nullable(),
});
export type StayRead = z.infer<typeof StayRead>;

/** The reconstruction of one booking, computed by `@lfsci/domain` bookingLine. */
export const BookingLineRead = z.object({
  grossServices: Money,
  refunds: Money,
  netOfRefunds: Money,
  commission: Money,
  taxCollected: Money,
  taxRemitted: Money,
  taxFlow: Money,
  net: Money,
});
export type BookingLineRead = z.infer<typeof BookingLineRead>;

export const BookingRow = z.object({
  id: Uuid,
  listingId: Uuid,
  listingLabel: z.string(),
  platform: ListingPlatform,
  externalBookingId: z.string().nullable(),
  status: BookingStatus,
  source: BookingSource.nullable(),
  currency: Currency,
  stay: StayRead,
  line: BookingLineRead,
  depositAmount: Money,
  payoutCount: z.number().int(),
  version: Version,
});
export type BookingRow = z.infer<typeof BookingRow>;

export const BookingMovementRead = z.object({
  id: Uuid,
  kind: BookingMovementKind,
  amount: Money,
  currency: Currency,
  occurredOn: IsoDate,
  isThirdPartyTax: z.boolean(),
  externalReference: z.string().nullable(),
});
export type BookingMovementRead = z.infer<typeof BookingMovementRead>;

export const BookingPayoutLink = z.object({
  payoutId: Uuid,
  externalPayoutId: z.string().nullable(),
  paidOn: IsoDate,
  amount: Money,
  label: z.string().nullable(),
  status: PayoutStatus,
});
export type BookingPayoutLink = z.infer<typeof BookingPayoutLink>;

export const BookingDetail = BookingRow.extend({
  createdAt: IsoDateTime,
  accommodationAmount: Money,
  cleaningAmount: Money,
  commissionAmount: Money,
  refundAmount: Money,
  touristTaxCollected: Money,
  touristTaxRemitted: Money,
  movements: z.array(BookingMovementRead),
  payouts: z.array(BookingPayoutLink),
  allowedTransitions: z.array(BookingStatus),
});
export type BookingDetail = z.infer<typeof BookingDetail>;

const BookingAmounts = {
  accommodationAmount: Money.optional(),
  cleaningAmount: Money.optional(),
  commissionAmount: Money.optional(),
  refundAmount: Money.optional(),
  touristTaxCollected: Money.optional(),
  touristTaxRemitted: Money.optional(),
  depositAmount: Money.optional(),
};

export const CreateBookingInput = z.strictObject({
  listingId: Uuid,
  externalBookingId: z.string().min(1).optional(),
  checkInOn: IsoDate,
  checkOutOn: IsoDate,
  guestName: z.string().min(1).optional(),
  guestCount: z.number().int().min(1).max(50).optional(),
  status: BookingStatus.optional(),
  ...BookingAmounts,
});
export type CreateBookingInput = z.infer<typeof CreateBookingInput>;

export const UpdateBookingInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  checkInOn: IsoDate.optional(),
  checkOutOn: IsoDate.optional(),
  guestCount: z.number().int().min(1).max(50).nullable().optional(),
  ...BookingAmounts,
});
export type UpdateBookingInput = z.infer<typeof UpdateBookingInput>;

export const CalendarEntry = z.object({
  bookingId: Uuid,
  listingId: Uuid,
  listingLabel: z.string(),
  startsOn: IsoDate,
  endsOn: IsoDate,
  nights: z.number().int(),
  status: BookingStatus,
  source: BookingSource.nullable(),
  label: z.string().nullable(),
});
export type CalendarEntry = z.infer<typeof CalendarEntry>;

export const CalendarRead = z.object({
  from: IsoDate,
  to: IsoDate,
  entries: z.array(CalendarEntry),
  feeds: z.array(
    z.object({
      listingId: Uuid,
      label: z.string(),
      lastPolledAt: IsoDateTime.nullable(),
      neverPolled: z.boolean(),
      stale: z.boolean(),
    }),
  ),
});
export type CalendarRead = z.infer<typeof CalendarRead>;

export const ImportKind = z.enum(["bookings", "payouts"]);
export type ImportKind = z.infer<typeof ImportKind>;

export const MappingColumn = z.object({
  field: z.string(),
  label: z.string(),
  required: z.boolean(),
  headers: z.array(z.string()),
});

/** AIR-02: a mapping is named and versioned; columns are matched by header name. */
export const MappingDescriptor = z.object({
  version: z.string(),
  kind: ImportKind,
  platform: ListingPlatform,
  label: z.string(),
  columns: z.array(MappingColumn),
});
export type MappingDescriptor = z.infer<typeof MappingDescriptor>;

export const PayoutAdjustmentRead = z.object({
  reference: z.string(),
  kind: z.enum(["correction", "retention", "other_period"]),
  amount: Money,
  label: z.string().nullable(),
});
export type PayoutAdjustmentRead = z.infer<typeof PayoutAdjustmentRead>;

export const PayoutLineRead = z.object({
  reference: z.string(),
  bookingId: Uuid.nullable(),
  grossServices: Money,
  refunds: Money,
  commission: Money,
  taxFlow: Money,
  net: Money,
  known: z.boolean(),
});
export type PayoutLineRead = z.infer<typeof PayoutLineRead>;

export const ReconciliationRead = z.object({
  externalPayoutId: z.string().nullable(),
  paidOn: IsoDate,
  currency: Currency,
  declaredNet: Money,
  bookingNet: Money,
  adjustmentTotal: Money,
  expectedNet: Money,
  difference: Money,
  matched: z.boolean(),
  grossServices: Money,
  refunds: Money,
  commissions: Money,
  taxCollected: Money,
  taxRemitted: Money,
  taxFlow: Money,
  revenueRecognised: Money,
  lines: z.array(PayoutLineRead),
  adjustments: z.array(PayoutAdjustmentRead),
  /** Rows the file settles that no known booking explains: shown, never absorbed. */
  unexplained: z.array(z.object({ reference: z.string(), amount: Money, reason: z.string() })),
});
export type ReconciliationRead = z.infer<typeof ReconciliationRead>;

export const ImportRowIssue = z.object({
  line: z.number().int(),
  field: z.string().nullable(),
  message: z.string(),
});
export type ImportRowIssue = z.infer<typeof ImportRowIssue>;

export const ImportPreviewRow = z.object({
  line: z.number().int(),
  reference: z.string(),
  checkInOn: IsoDate.nullable(),
  checkOutOn: IsoDate.nullable(),
  nights: z.number().int().nullable(),
  guestName: z.string().nullable(),
  net: Money,
  duplicate: z.boolean(),
  duplicateReason: z.enum(["already_imported", "duplicate_in_file"]).nullable(),
});
export type ImportPreviewRow = z.infer<typeof ImportPreviewRow>;

export const ImportPreview = z.object({
  mappingVersion: z.string(),
  kind: ImportKind,
  delimiter: z.string(),
  headers: z.array(z.string()),
  mappedColumns: z.array(z.object({ field: z.string(), header: z.string() })),
  missingColumns: z.array(z.string()),
  unknownColumns: z.array(z.string()),
  rowCount: z.number().int(),
  newCount: z.number().int(),
  duplicateCount: z.number().int(),
  rows: z.array(ImportPreviewRow),
  issues: z.array(ImportRowIssue),
  totals: z.object({
    declared: Money.nullable(),
    computed: Money,
    difference: Money.nullable(),
    matched: z.boolean(),
  }),
  payouts: z.array(ReconciliationRead),
  /** True while something must be fixed before writing anything. */
  blocked: z.boolean(),
  blockedReasons: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

export const ImportResult = z.object({
  mappingVersion: z.string(),
  kind: ImportKind,
  bookingsCreated: z.number().int(),
  payoutsCreated: z.number().int(),
  movementsCreated: z.number().int(),
  detailsCreated: z.number().int(),
  skippedDuplicates: z.number().int(),
  varianceCount: z.number().int(),
});
export type ImportResult = z.infer<typeof ImportResult>;

const ImportFile = {
  mappingVersion: z.string().min(1),
  /** The file itself; the import reads no path and keeps no upload. */
  content: z.string().min(1).max(4_000_000),
  listingId: Uuid.optional(),
  legalEntityId: Uuid.optional(),
  declaredTotal: Money.optional(),
};

export const ImportPreviewInput = z.strictObject(ImportFile);
export type ImportPreviewInput = z.infer<typeof ImportPreviewInput>;

export const ImportCommitInput = z.strictObject(ImportFile);
export type ImportCommitInput = z.infer<typeof ImportCommitInput>;

export const PayoutRow = z.object({
  id: Uuid,
  platform: ListingPlatform,
  externalPayoutId: z.string().nullable(),
  legalEntityId: Uuid,
  legalEntityName: z.string(),
  paidOn: IsoDate,
  netAmount: Money,
  currency: Currency,
  status: PayoutStatus,
  varianceAmount: Money,
  importMappingVersion: z.string().nullable(),
  detailCount: z.number().int(),
  version: Version,
});
export type PayoutRow = z.infer<typeof PayoutRow>;

export const PayoutDetailRead = PayoutRow.extend({
  createdAt: IsoDateTime,
  details: z.array(
    z.object({
      id: Uuid,
      label: z.string().nullable(),
      amount: Money,
      currency: Currency,
      bookingId: Uuid.nullable(),
      bookingReference: z.string().nullable(),
      movementKind: BookingMovementKind.nullable(),
    }),
  ),
  reconciliation: ReconciliationRead,
});
export type PayoutDetailRead = z.infer<typeof PayoutDetailRead>;

export const ListingPage = paginated(ListingRow);
export const BookingPage = paginated(BookingRow);
export const PayoutPage = paginated(PayoutRow);
export const MappingList = z.object({ items: z.array(MappingDescriptor) });

const route = (path: string, summary: string, method: "GET" | "POST" = "POST") =>
  oc.route({ method, path: `/courte-duree${path}`, summary });

export const courteDureeContract = {
  courteDuree: {
    lookups: route("/references", "Lots, SCI et annonces sélectionnables", "GET")
      .input(z.strictObject({}))
      .output(CourteDureeLookups),
    listings: {
      list: route("/annonces", "Liste des annonces", "GET")
        .input(
          listInput({
            status: ListingStatus.optional(),
            platform: ListingPlatform.optional(),
            search: z.string().optional(),
          }),
        )
        .output(ListingPage),
      get: route("/annonces/get", "Fiche annonce")
        .input(z.strictObject({ id: Uuid }))
        .output(ListingDetail),
      create: route("/annonces/creer", "Créer une annonce")
        .input(CreateListingInput)
        .output(ListingDetail),
      update: route("/annonces/modifier", "Modifier une annonce")
        .input(UpdateListingInput)
        .output(ListingDetail),
      setStatus: route("/annonces/statut", "Changer l’état d’une annonce")
        .input(z.strictObject({ id: Uuid, expectedVersion: Version, status: ListingStatus }))
        .output(ListingDetail),
    },
    bookings: {
      list: route("/reservations", "Liste des réservations", "GET")
        .input(
          listInput({
            listingId: Uuid.optional(),
            status: BookingStatus.optional(),
            from: IsoDate.optional(),
            to: IsoDate.optional(),
            search: z.string().optional(),
          }),
        )
        .output(BookingPage),
      get: route("/reservations/get", "Fiche réservation")
        .input(z.strictObject({ id: Uuid }))
        .output(BookingDetail),
      create: route("/reservations/creer", "Créer une réservation")
        .input(CreateBookingInput)
        .output(BookingDetail),
      update: route("/reservations/modifier", "Modifier une réservation")
        .input(UpdateBookingInput)
        .output(BookingDetail),
      setStatus: route("/reservations/statut", "Changer l’état d’une réservation")
        .input(z.strictObject({ id: Uuid, expectedVersion: Version, status: BookingStatus }))
        .output(BookingDetail),
      calendar: route("/calendrier", "Calendrier des séjours", "GET")
        .input(z.strictObject({ from: IsoDate, to: IsoDate, listingId: Uuid.optional() }))
        .output(CalendarRead),
    },
    availability: {
      get: route("/disponibilite", "Disponibilité lue depuis un calendrier iCal", "GET")
        .input(
          z.strictObject({ listingId: Uuid, from: IsoDate.optional(), to: IsoDate.optional() }),
        )
        .output(AvailabilityRead),
    },
    imports: {
      mappings: route("/import/mappings", "Mappings d’import disponibles", "GET")
        .input(z.strictObject({ kind: ImportKind.optional() }))
        .output(MappingList),
      preview: route("/import/apercu", "Aperçu d’un import, sans écriture")
        .input(ImportPreviewInput)
        .output(ImportPreview),
      commit: route("/import/valider", "Importer le fichier contrôlé")
        .input(ImportCommitInput)
        .output(ImportResult),
    },
    payouts: {
      list: route("/versements", "Liste des versements plateforme", "GET")
        .input(listInput({ status: PayoutStatus.optional(), platform: ListingPlatform.optional() }))
        .output(PayoutPage),
      get: route("/versements/get", "Rapprochement d’un versement")
        .input(z.strictObject({ id: Uuid }))
        .output(PayoutDetailRead),
      decide: route("/versements/decider", "Confirmer ou rejeter un versement")
        .input(
          z.strictObject({
            id: Uuid,
            expectedVersion: Version,
            decision: z.enum(["confirm", "reject"]),
          }),
        )
        .output(PayoutDetailRead),
    },
  },
};
