import { IsoDate, Money } from "@lfsci/contracts";
import { z } from "zod";
import { field } from "./field";

const Line = z.object({
  description: field(z.string().max(300)),
  amount: field(Money),
});

const ChargesKind = z.enum(["provision", "forfait", "reel", "aucune", "inconnu"]);
const MeterUnit = z.enum(["m3", "kWh", "MWh", "L", "inconnu"]);

export const ReceiptExtraction = z.strictObject({
  supplier: field(z.string().max(200)),
  date: field(IsoDate),
  totalInclTax: field(Money),
  totalExclTax: field(Money),
  tax: field(Money),
  lines: z.array(Line).max(200),
  paymentMethodHint: field(z.string().max(80)),
});
export type ReceiptExtraction = z.infer<typeof ReceiptExtraction>;

export const InvoiceExtraction = z.strictObject({
  supplier: field(z.string().max(200)),
  supplierReference: field(z.string().max(120)),
  date: field(IsoDate),
  dueDate: field(IsoDate),
  servicePeriodFrom: field(IsoDate),
  servicePeriodTo: field(IsoDate),
  totalInclTax: field(Money),
  totalExclTax: field(Money),
  tax: field(Money),
  lines: z.array(Line).max(200),
  /** Whether a bank account appears on the document. The value itself is never extracted. */
  ibanPresent: field(z.boolean()),
  paymentMethodHint: field(z.string().max(80)),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtraction>;

export const AttestationExtraction = z.strictObject({
  insurer: field(z.string().max(200)),
  policyNumber: field(z.string().max(80)),
  insuredName: field(z.string().max(200)),
  address: field(z.string().max(300)),
  coverage: field(z.array(z.string().max(200)).max(40)),
  validFrom: field(IsoDate),
  validTo: field(IsoDate),
});
export type AttestationExtraction = z.infer<typeof AttestationExtraction>;

export const LeaseExtraction = z.strictObject({
  parties: field(z.array(z.string().max(200)).max(20)),
  unitAddress: field(z.string().max(300)),
  start: field(IsoDate),
  durationMonths: field(z.number().int().min(1).max(1200)),
  rent: field(Money),
  chargesKind: field(ChargesKind),
  chargesAmount: field(Money),
  deposit: field(Money),
  revisionClause: field(z.string().max(600)),
  revisionIndexQuarter: field(z.string().max(20)),
});
export type LeaseExtraction = z.infer<typeof LeaseExtraction>;

export const MeterPhotoExtraction = z.strictObject({
  meterSerial: field(z.string().max(80)),
  index: field(z.string().max(40)),
  unitOfMeasure: field(MeterUnit),
});
export type MeterPhotoExtraction = z.infer<typeof MeterPhotoExtraction>;

export const InboxIntentKind = z.enum([
  "tenant_notice",
  "insurance_attestation",
  "invoice",
  "receipt",
  "maintenance_request",
  "appointment",
  "payment_info",
  "unknown",
]);
export type InboxIntentKind = z.infer<typeof InboxIntentKind>;

/**
 * Deliberately has no field naming a recipient, a permission or an action:
 * the content is untrusted data, never a command (IA-02).
 */
export const InboxIntentExtraction = z.strictObject({
  kind: field(InboxIntentKind),
  personHint: field(z.string().max(200)),
  unitHint: field(z.string().max(200)),
  leaseHint: field(z.string().max(200)),
  whyUncertain: z.string().max(600),
});
export type InboxIntentExtraction = z.infer<typeof InboxIntentExtraction>;
