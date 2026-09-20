import { z } from "zod";
import { ObjectRef } from "../entities";
import { IsoDateTime } from "../primitives";

/** UX-01: every home card says why it is there, what blocks, what is proposed and the expected effect. */
export const ActionRequiredCard = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "approval_pending",
    "unallocated_payment",
    "late_rent",
    "expense_to_review",
    "inbox_ambiguous",
    "deadline_due",
    "command_exception",
    "document_missing",
    "integration_degraded",
  ]),
  why: z.string().min(1),
  blocking: z.boolean(),
  proposedAction: z.string().min(1),
  expectedEffect: z.string().min(1),
  severity: z.enum(["info", "warning", "critical"]),
  objectRefs: z.array(ObjectRef),
  groupedCount: z.number().int().positive().optional(),
});
export type ActionRequiredCard = z.infer<typeof ActionRequiredCard>;

/** UX-01: a global green state is forbidden while a critical control has failed. */
export const SituationBanner = z.object({
  controls: z.enum(["complete", "partial", "sources_unavailable"]),
  lastRunAt: IsoDateTime.nullable(),
  failed: z.array(z.string()),
});
export type SituationBanner = z.infer<typeof SituationBanner>;

export const getActionRequired = {
  input: z.strictObject({ limit: z.number().int().min(1).max(50).default(20) }),
  output: z.object({
    banner: SituationBanner,
    cards: z.array(ActionRequiredCard),
  }),
};
