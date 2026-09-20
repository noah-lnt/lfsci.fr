import {
  DeadlinePriority,
  DeadlineStatus,
  IsoDate,
  IsoDateTime,
  ObjectRef,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** TMP-03: 7 / 30 / 90 / 365 day horizons, plus what is already late. */
export const DeadlineHorizon = z.enum(["overdue", "d7", "d30", "d90", "d365", "later"]);
export type DeadlineHorizon = z.infer<typeof DeadlineHorizon>;

export const DeadlineRow = z.object({
  id: Uuid,
  version: Version,
  type: z.string(),
  title: z.string(),
  dueOn: IsoDate,
  originalDueOn: IsoDate.nullable(),
  priority: DeadlinePriority,
  status: DeadlineStatus,
  assigneeUserId: Uuid.nullable(),
  postponedReason: z.string().nullable(),
  completedAt: IsoDateTime.nullable(),
  horizon: DeadlineHorizon,
  objects: z.array(ObjectRef),
});
export type DeadlineRow = z.infer<typeof DeadlineRow>;

export const DeadlineListResult = z.object({
  items: z.array(DeadlineRow),
  counts: z.record(DeadlineHorizon, z.number().int().nonnegative()),
});
export type DeadlineListResult = z.infer<typeof DeadlineListResult>;

export const echeancierContract = {
  echeancier: {
    list: oc
      .route({ method: "GET", path: "/echeancier", summary: "Échéances par horizon" })
      .input(
        z.object({
          horizon: DeadlineHorizon.optional(),
          type: z.string().min(1).max(80).optional(),
          assigneeUserId: Uuid.optional(),
          objectId: Uuid.optional(),
          includeClosed: z.boolean().default(false),
          limit: z.number().int().min(1).max(500).default(200),
        }),
      )
      .output(DeadlineListResult),
    complete: oc
      .route({ method: "POST", path: "/echeancier/{id}/completion", summary: "Accomplir" })
      .input(
        z.object({
          id: Uuid,
          expectedVersion: Version,
          observedOn: IsoDate.optional(),
          note: z.string().min(1).max(500).optional(),
        }),
      )
      .output(DeadlineRow),
    postpone: oc
      .route({ method: "POST", path: "/echeancier/{id}/postponement", summary: "Reporter" })
      .input(
        z.object({
          id: Uuid,
          expectedVersion: Version,
          newDueOn: IsoDate,
          reason: z.string().min(1).max(500),
        }),
      )
      .output(DeadlineRow),
  },
};
