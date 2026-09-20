import type { z } from "zod";
import { ClaimIndemnityKind } from "../enums";
import { Audited, Currency, IsoDate, Money, Uuid } from "../primitives";

/**
 * SIN-01: one indemnity actually received, kept gross. The authority is the
 * accounting ledger, so a row exists because a payment was seen, never because
 * the app expected one.
 */
export const ClaimIndemnity = Audited.extend({
  claimId: Uuid,
  amount: Money,
  currency: Currency,
  receivedOn: IsoDate.nullable(),
  paymentId: Uuid.nullable(),
  kind: ClaimIndemnityKind,
});
export type ClaimIndemnity = z.infer<typeof ClaimIndemnity>;
