import { z } from "zod";
import { BookingSource, BookingStatus, PayoutStatus } from "../enums";
import { Audited, Currency, IsoDate, Money, Uuid } from "../primitives";

export const Booking = Audited.extend({
  listingId: Uuid,
  unitId: Uuid,
  platform: z.string(),
  externalBookingId: z.string().nullable(),
  guestPersonId: Uuid.nullable(),
  guestCount: z.number().int().nullable(),
  checkInOn: IsoDate,
  checkOutOn: IsoDate,
  nights: z.number().int().positive(),
  accommodationAmount: Money,
  cleaningAmount: Money,
  commissionAmount: Money,
  refundAmount: Money,
  touristTaxCollected: Money,
  touristTaxRemitted: Money,
  depositAmount: Money,
  currency: Currency,
  status: BookingStatus,
  source: BookingSource.nullable(),
});
export type Booking = z.infer<typeof Booking>;

export const Payout = Audited.extend({
  legalEntityId: Uuid,
  platform: z.string(),
  externalPayoutId: z.string().nullable(),
  paidOn: IsoDate,
  netAmount: Money,
  currency: Currency,
  bankTransactionId: Uuid.nullable(),
  status: PayoutStatus,
  varianceAmount: Money,
});
export type Payout = z.infer<typeof Payout>;
