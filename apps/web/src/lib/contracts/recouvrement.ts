import { Currency, IsoDate, IsoDateTime, Money, Uuid, Version } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** LOY-04: an unpaid term is qualified before it is chased. */
export const ArrearsQualification = z.enum([
  "due",
  "unapplied_receipt",
  "payment_in_transit",
  "disputed",
  "sync_incident",
]);
export type ArrearsQualification = z.infer<typeof ArrearsQualification>;

export const ReminderLevel = z.enum(["reminder_1", "reminder_2", "formal_notice"]);
export type ReminderLevel = z.infer<typeof ReminderLevel>;

export const ReminderHoldReason = z.enum([
  "settled",
  "suspended",
  "negligible_amount",
  "within_grace",
  "max_level_reached",
  "too_soon",
]);
export type ReminderHoldReason = z.infer<typeof ReminderHoldReason>;

export const ArrearsTermRead = z.object({
  rentTermId: Uuid,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  dueOn: IsoDate,
  total: Money,
  allocated: Money,
  outstanding: Money,
  qualification: ArrearsQualification,
});
export type ArrearsTermRead = z.infer<typeof ArrearsTermRead>;

/** MSG-01: the history keeps the template and the version that produced each message. */
export const ReminderHistoryEntry = z.object({
  messageId: Uuid,
  level: ReminderLevel.nullable(),
  templateCode: z.string().nullable(),
  templateVersion: z.string().nullable(),
  subject: z.string().nullable(),
  recipient: z.string(),
  status: z.string(),
  errorCode: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  commandId: Uuid.nullable(),
  commandStatus: z.string().nullable(),
  sentAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type ReminderHistoryEntry = z.infer<typeof ReminderHistoryEntry>;

export const ArrearsRow = z.object({
  leaseId: Uuid,
  leaseVersion: Version,
  leaseReference: z.string(),
  leaseStatus: z.string(),
  tenantPersonId: Uuid.nullable(),
  tenantName: z.string().nullable(),
  recipientContactPointId: Uuid.nullable(),
  recipientAddress: z.string().nullable(),
  currency: Currency,
  outstanding: Money,
  oldestDueOn: IsoDate,
  daysLate: z.number().int(),
  qualification: ArrearsQualification,
  suspended: z.boolean(),
  lastLevel: ReminderLevel.nullable(),
  lastSentOn: IsoDate.nullable(),
  nextLevel: ReminderLevel.nullable(),
  nextAutonomy: z.enum(["C", "D"]).nullable(),
  holdReason: ReminderHoldReason.nullable(),
  terms: z.array(ArrearsTermRead),
  reminders: z.array(ReminderHistoryEntry),
});
export type ArrearsRow = z.infer<typeof ArrearsRow>;

export const ReminderPolicyRead = z.object({
  graceDays: z.number().int(),
  firstReminderDays: z.number().int(),
  secondReminderDays: z.number().int(),
  formalNoticeDays: z.number().int(),
  minimumSpacingDays: z.number().int(),
  minimumOutstanding: Money,
});
export type ReminderPolicyRead = z.infer<typeof ReminderPolicyRead>;

export const RecouvrementScreen = z.object({
  asOf: IsoDate,
  policy: ReminderPolicyRead,
  totals: z.object({
    leases: z.number().int(),
    suspended: z.number().int(),
    outstanding: Money,
    currency: Currency,
  }),
  rows: z.array(ArrearsRow),
});
export type RecouvrementScreen = z.infer<typeof RecouvrementScreen>;

export const ProposeReminderInput = z.strictObject({
  leaseId: Uuid,
  level: ReminderLevel,
  asOf: IsoDate.optional(),
});
export type ProposeReminderInput = z.infer<typeof ProposeReminderInput>;

export const ProposeReminderResult = z.object({
  commandId: Uuid,
  commandStatus: z.string(),
  decisionLevel: z.enum(["C", "D"]),
  messageId: Uuid,
  level: ReminderLevel,
  templateCode: z.string(),
  templateVersion: z.string(),
  subject: z.string(),
  body: z.string(),
  screen: RecouvrementScreen,
});
export type ProposeReminderResult = z.infer<typeof ProposeReminderResult>;

export const recouvrementContract = {
  recouvrement: {
    list: oc
      .route({ method: "GET", path: "/recouvrement", summary: "Retards et impayés" })
      .input(z.strictObject({ asOf: IsoDate.optional() }))
      .output(RecouvrementScreen),
    propose: oc
      .route({
        method: "POST",
        path: "/recouvrement/relance",
        summary: "Préparer la relance du niveau suivant (validation requise)",
      })
      .input(ProposeReminderInput)
      .output(ProposeReminderResult),
  },
};
