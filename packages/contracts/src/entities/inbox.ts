import { z } from "zod";
import { InboxItemSource, InboxItemStatus } from "../enums";
import { Audited, IsoDateTime, Uuid, Version } from "../primitives";
import { ObjectRef } from "./common";

export const InboxItem = Audited.extend({
  activityId: Uuid.nullable(),
  documentId: Uuid.nullable(),
  source: InboxItemSource,
  sourceReference: z.string().nullable(),
  proposedObject: ObjectRef.nullable(),
  proposedAction: z.string().nullable(),
  uncertaintyReason: z.string().nullable(),
  status: InboxItemStatus,
  rejectedReason: z.string().nullable(),
  duplicateOfInboxItemId: Uuid.nullable(),
  processedAt: IsoDateTime.nullable(),
});
export type InboxItem = z.infer<typeof InboxItem>;

/** What the owner decides on one inbox item (INB-01: attach, reject or park). */
export const InboxDecisionInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  decision: z.enum(["attach", "reject", "quarantine", "mark_duplicate"]),
  attachTo: ObjectRef.optional(),
  duplicateOfInboxItemId: Uuid.optional(),
  reason: z.string().min(1).optional(),
});
export type InboxDecisionInput = z.infer<typeof InboxDecisionInput>;

/** Structured triage proposal produced by the AI layer (IA-01/IA-02: data, never instructions). */
export const InboxIntent = z.strictObject({
  proposedObject: ObjectRef.nullable(),
  proposedAction: z.string().nullable(),
  documentKindGuess: z.string().nullable(),
  uncertaintyReason: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
export type InboxIntent = z.infer<typeof InboxIntent>;
