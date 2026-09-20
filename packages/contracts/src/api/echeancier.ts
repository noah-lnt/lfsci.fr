import { z } from "zod";
import { byId, Deadline, listInput, paginated } from "../entities";
import { DeadlinePriority, DeadlineStatus } from "../enums";
import { IsoDate, Uuid, Version } from "../primitives";

export const listDeadlines = {
  input: listInput({
    status: DeadlineStatus.optional(),
    priority: DeadlinePriority.optional(),
    dueFrom: IsoDate.optional(),
    dueTo: IsoDate.optional(),
    assigneeUserId: Uuid.optional(),
    openOnly: z.boolean().optional(),
  }),
  output: paginated(Deadline),
};
export const getDeadline = { input: byId, output: Deadline };

/** TMP-01: completion references an actual event; the planned date is never overwritten. */
export const completeDeadline = {
  input: z.strictObject({
    id: Uuid,
    expectedVersion: Version,
    completedEventId: Uuid,
  }),
  output: Deadline,
};

export const postponeDeadline = {
  input: z.strictObject({
    id: Uuid,
    expectedVersion: Version,
    newDueOn: IsoDate,
    reason: z.string().min(1),
  }),
  output: Deadline,
};
