import {
  InboxItemSource,
  InboxItemStatus,
  IsoDateTime,
  ObjectRef,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** INB-01: source, original, extracted fields, proposed links, action and why uncertain. */
export const InboxRow = z.object({
  id: Uuid,
  version: Version,
  source: InboxItemSource,
  sourceReference: z.string().nullable(),
  status: InboxItemStatus,
  receivedAt: IsoDateTime,
  summary: z.string().nullable(),
  channel: z.string().nullable(),
  declaredAuthor: z.string().nullable(),
  documentId: Uuid.nullable(),
  activityId: Uuid.nullable(),
  proposedObject: ObjectRef.nullable(),
  proposedObjectLabel: z.string().nullable(),
  proposedAction: z.string().nullable(),
  uncertaintyReason: z.string().nullable(),
});
export type InboxRow = z.infer<typeof InboxRow>;

export const ExtractedField = z.object({
  fieldPath: z.string(),
  value: z.string().nullable(),
  confidence: z.string().nullable(),
  evidenceExcerpt: z.string().nullable(),
  decision: z.string(),
});
export type ExtractedField = z.infer<typeof ExtractedField>;

export const InboxDetail = InboxRow.extend({
  bodyRaw: z.string().nullable(),
  subject: z.string().nullable(),
  fields: z.array(ExtractedField),
});
export type InboxDetail = z.infer<typeof InboxDetail>;

export const InboxListResult = z.object({ items: z.array(InboxRow), openCount: z.number().int() });
export type InboxListResult = z.infer<typeof InboxListResult>;

/**
 * `createExpense` and `createIntervention` hand the item over to the finance and
 * travaux capture forms; this module never writes an expense itself.
 */
export const InboxDecision = z.enum([
  "attach",
  "dismiss",
  "createExpense",
  "createIntervention",
  "quarantine",
]);
export type InboxDecision = z.infer<typeof InboxDecision>;

export const InboxDecisionResult = z.object({
  item: InboxRow,
  handoffHref: z.string().nullable(),
});
export type InboxDecisionResult = z.infer<typeof InboxDecisionResult>;

export const AttachTarget = z.object({ object: ObjectRef, label: z.string() });
export type AttachTarget = z.infer<typeof AttachTarget>;

export const inboxContract = {
  inbox: {
    list: oc
      .route({ method: "GET", path: "/inbox", summary: "File de tri" })
      .input(
        z.object({
          status: InboxItemStatus.optional(),
          openOnly: z.boolean().default(true),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .output(InboxListResult),
    get: oc
      .route({ method: "GET", path: "/inbox/{id}", summary: "Détail d’un élément" })
      .input(z.object({ id: Uuid }))
      .output(InboxDetail),
    decide: oc
      .route({ method: "POST", path: "/inbox/{id}/decision", summary: "Décision de tri" })
      .input(
        z.object({
          id: Uuid,
          expectedVersion: Version,
          decision: InboxDecision,
          attachTo: ObjectRef.optional(),
          reason: z.string().min(1).max(500).optional(),
        }),
      )
      .output(InboxDecisionResult),
    targets: oc
      .route({ method: "GET", path: "/inbox/targets", summary: "Objets rattachables" })
      .input(
        z.object({
          query: z.string().max(120).optional(),
          limit: z.number().int().min(1).max(50).default(25),
        }),
      )
      .output(z.object({ items: z.array(AttachTarget) })),
    captureNote: oc
      .route({ method: "POST", path: "/inbox/notes", summary: "Capture manuelle" })
      .input(
        z.object({
          text: z.string().min(1).max(8000),
          channel: z.enum(["note", "sms"]).default("note"),
          declaredAuthor: z.string().min(1).max(200).optional(),
          about: ObjectRef.optional(),
        }),
      )
      .output(InboxRow),
  },
};
