import { z } from "zod";
import {
  ActivityChannel,
  ActivityDirection,
  DeadlinePriority,
  DeadlineRecurrenceAnchor,
  DeadlineStatus,
  EventOrigin,
} from "../enums";
import { Audited, IsoDate, IsoDateTime, Uuid } from "../primitives";
import { ObjectRef } from "./common";

export const Activity = Audited.extend({
  channel: ActivityChannel,
  direction: ActivityDirection,
  subject: z.string().nullable(),
  bodyRaw: z.string().nullable(),
  declaredAuthor: z.string().nullable(),
  authorPersonId: Uuid.nullable(),
  authorUserId: Uuid.nullable(),
  externalId: z.string().nullable(),
  capturedAt: IsoDateTime.nullable(),
  receivedAt: IsoDateTime,
  occurredAt: IsoDateTime,
  objects: z.array(ObjectRef),
});
export type Activity = z.infer<typeof Activity>;

export const EventEntity = Audited.extend({
  type: z.string(),
  primaryObject: ObjectRef,
  effectiveOn: IsoDate.nullable(),
  occurredAt: IsoDateTime,
  recordedAt: IsoDateTime,
  origin: EventOrigin,
  actorUserId: Uuid.nullable(),
  actorLabel: z.string().nullable(),
  sourceActivityId: Uuid.nullable(),
  payload: z.record(z.string(), z.unknown()),
  objects: z.array(ObjectRef),
});
export type EventEntity = z.infer<typeof EventEntity>;

export const Deadline = Audited.extend({
  type: z.string(),
  title: z.string(),
  dueOn: IsoDate,
  originalDueOn: IsoDate.nullable(),
  remindFromOn: IsoDate.nullable(),
  priority: DeadlinePriority,
  assigneeUserId: Uuid.nullable(),
  ruleVersionId: Uuid.nullable(),
  recurrenceRule: z.string().nullable(),
  recurrenceAnchor: DeadlineRecurrenceAnchor.nullable(),
  parentDeadlineId: Uuid.nullable(),
  status: DeadlineStatus,
  postponedReason: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  completedEventId: Uuid.nullable(),
  completedAt: IsoDateTime.nullable(),
  objects: z.array(ObjectRef),
});
export type Deadline = z.infer<typeof Deadline>;

export const TimelineItem = z.discriminatedUnion("itemKind", [
  z.object({ itemKind: z.literal("activity"), activity: Activity }),
  z.object({ itemKind: z.literal("event"), event: EventEntity }),
  z.object({ itemKind: z.literal("deadline"), deadline: Deadline }),
]);
export type TimelineItem = z.infer<typeof TimelineItem>;
