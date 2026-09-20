import { Currency, IsoDate, IsoDateTime, Money, Uuid, Version } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const IndexName = z.enum(["irl", "ilc", "ilat"]);
export type IndexName = z.infer<typeof IndexName>;

export const IndexValueRead = z.object({
  value: z.string(),
  quarter: z.number().int().min(1).max(4),
  year: z.number().int(),
  period: z.string(),
});
export type IndexValueRead = z.infer<typeof IndexValueRead>;

export const RevisionBlockedReason = z.enum([
  "missing_clause",
  "missing_index",
  "quarter_mismatch",
  "dpe_frozen",
  "not_due_yet",
]);
export type RevisionBlockedReason = z.infer<typeof RevisionBlockedReason>;

export const RevisionProposalRead = z.object({
  available: z.boolean(),
  blockedReason: RevisionBlockedReason.nullable(),
  missing: z.array(z.string()),
  currentRent: Money.nullable(),
  newRent: Money.nullable(),
  /** IRL-01: the exact quotient is kept, not only the rounded rent. */
  newRentUnrounded: z.string().nullable(),
  increase: Money.nullable(),
  baseIndex: IndexValueRead.nullable(),
  newIndex: IndexValueRead.nullable(),
  effectiveFrom: IsoDate.nullable(),
  retroactive: z.boolean(),
});
export type RevisionProposalRead = z.infer<typeof RevisionProposalRead>;

export const RevisionHistoryEntry = z.object({
  id: Uuid,
  indexName: IndexName,
  referenceQuarter: z.string(),
  previousIndexValue: z.string(),
  newIndexValue: z.string(),
  baseRent: Money,
  proposedRent: Money,
  computedRentUnrounded: z.string(),
  currency: Currency,
  requestedOn: IsoDate.nullable(),
  effectiveOn: IsoDate.nullable(),
  status: z.enum(["blocked", "proposed", "approved", "applied", "refused", "expired"]),
  blockingReason: z.string().nullable(),
  commandId: Uuid.nullable(),
  commandStatus: z.string().nullable(),
  letterDocumentId: Uuid.nullable(),
  createdAt: IsoDateTime,
});
export type RevisionHistoryEntry = z.infer<typeof RevisionHistoryEntry>;

/** IRL-01: the screen shows the clause, the series and the DPE, not only a number. */
export const RevisionContext = z.object({
  leaseId: Uuid,
  leaseReference: z.string(),
  leaseVersion: Version,
  currency: Currency,
  indexName: IndexName.nullable(),
  referenceQuarter: z.string().nullable(),
  revisionMonth: z.number().int().min(1).max(12).nullable(),
  nextRevisionOn: IsoDate.nullable(),
  energyClass: z.enum(["A", "B", "C", "D", "E", "F", "G"]).nullable(),
  territory: z.enum(["metropole", "outre_mer"]),
  unitLabel: z.string().nullable(),
  chargeAmount: Money.nullable(),
  seriesUpdatedAt: IsoDateTime.nullable(),
  seriesSource: z.string().nullable(),
  observations: z.array(IndexValueRead),
});
export type RevisionContext = z.infer<typeof RevisionContext>;

export const RevisionScreen = z.object({
  context: RevisionContext,
  proposal: RevisionProposalRead,
  history: z.array(RevisionHistoryEntry),
});
export type RevisionScreen = z.infer<typeof RevisionScreen>;

export const PrepareRevisionInput = z.strictObject({
  leaseId: Uuid,
  expectedVersion: Version,
  requestDate: IsoDate.optional(),
});
export type PrepareRevisionInput = z.infer<typeof PrepareRevisionInput>;

export const PrepareRevisionResult = z.object({
  screen: RevisionScreen,
  revisionId: Uuid,
  commandId: Uuid,
  commandStatus: z.string(),
  decisionLevel: z.enum(["A", "B", "C", "D"]),
});
export type PrepareRevisionResult = z.infer<typeof PrepareRevisionResult>;

export const LetterInput = z.strictObject({ revisionId: Uuid });
export type LetterInput = z.infer<typeof LetterInput>;

export const LetterResult = z.object({
  documentId: Uuid,
  jobId: z.string().nullable(),
  screen: RevisionScreen,
});
export type LetterResult = z.infer<typeof LetterResult>;

export const revisionsContract = {
  revisions: {
    get: oc
      .route({ method: "GET", path: "/revisions/{leaseId}", summary: "Révision du bail" })
      .input(z.strictObject({ leaseId: Uuid, requestDate: IsoDate.optional() }))
      .output(RevisionScreen),
    prepare: oc
      .route({
        method: "POST",
        path: "/revisions/preparer",
        summary: "Préparer la révision (validation requise)",
      })
      .input(PrepareRevisionInput)
      .output(PrepareRevisionResult),
    letter: oc
      .route({ method: "POST", path: "/revisions/courrier", summary: "Éditer le courrier" })
      .input(LetterInput)
      .output(LetterResult),
  },
};
