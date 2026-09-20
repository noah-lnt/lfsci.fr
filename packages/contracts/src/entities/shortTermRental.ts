import { z } from "zod";
import { BookingMovementKind, ListingPlatform, ListingStatus } from "../enums";
import { Audited, Currency, IsoDate, IsoDateTime, Money, Uuid } from "../primitives";

export const Listing = Audited.extend({
  unitId: Uuid,
  platform: ListingPlatform,
  externalListingId: z.string().nullable(),
  title: z.string().nullable(),
  icalImportUrl: z.string().nullable(),
  icalExportUrl: z.string().nullable(),
  icalLastPolledAt: IsoDateTime.nullable(),
  registrationNumber: z.string().nullable(),
  registrationCheckedOn: IsoDate.nullable(),
  status: ListingStatus,
});
export type Listing = z.infer<typeof Listing>;

export const BookingMovement = Audited.extend({
  bookingId: Uuid,
  kind: BookingMovementKind,
  amount: Money,
  currency: Currency,
  occurredOn: IsoDate,
  /** AIR-02 / F04: a tax collected for a third party is never a revenue line. */
  isThirdPartyTax: z.boolean(),
  externalReference: z.string().nullable(),
});
export type BookingMovement = z.infer<typeof BookingMovement>;

export const PayoutDetail = Audited.extend({
  payoutId: Uuid,
  bookingId: Uuid.nullable(),
  bookingMovementId: Uuid.nullable(),
  label: z.string().nullable(),
  amount: Money,
  currency: Currency,
});
export type PayoutDetail = z.infer<typeof PayoutDetail>;
