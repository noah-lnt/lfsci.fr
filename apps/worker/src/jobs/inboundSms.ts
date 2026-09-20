import { tables, withTenant } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { smsmodeV1Adapter } from "@lfsci/sms";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

export const InboundSmsData = JobBase.extend({
  organizationId: z.uuid(),
  payload: z.record(z.string(), z.unknown()),
});
export type InboundSmsData = z.infer<typeof InboundSmsData>;

export async function ingestInboundSms(deps: Deps, data: InboundSmsData): Promise<JobOutcome> {
  const { organizationId } = data;
  const message = smsmodeV1Adapter.parseInbound(data.payload);
  if (message.providerMessageId === "") {
    throw new AppError("VALIDATION", { message: "inbound sms without a provider id" });
  }

  const existing = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select({ id: tables.activity.id })
      .from(tables.activity)
      .where(
        and(
          eq(tables.activity.channel, "sms"),
          eq(tables.activity.externalId, message.providerMessageId),
        ),
      )
      .limit(1);
    return rows[0];
  });
  if (existing) return { outcome: "duplicate", activityId: existing.id };

  const result = await withTenant(deps.db, { organizationId }, async (tx) => {
    const activityRows = await tx
      .insert(tables.activity)
      .values({
        organizationId,
        channel: "sms",
        direction: "inbound",
        bodyRaw: message.text,
        declaredAuthor: message.from,
        externalId: message.providerMessageId,
        occurredAt: message.receivedAt ?? new Date().toISOString(),
      })
      .returning({ id: tables.activity.id });
    const activity = activityRows[0];
    if (!activity) throw new AppError("CONFLICT", { message: "activity insert returned none" });

    const inboxRows = await tx
      .insert(tables.inboxItem)
      .values({
        organizationId,
        activityId: activity.id,
        source: "sms_paste",
        sourceReference: message.providerMessageId,
        status: "received",
      })
      .returning({ id: tables.inboxItem.id });
    const inbox = inboxRows[0];
    if (!inbox) throw new AppError("CONFLICT", { message: "inbox_item insert returned none" });
    return { activityId: activity.id, inboxItemId: inbox.id };
  });

  return { outcome: "ingested", ...result };
}

export const inboundSms = defineJob({
  name: "inbound.sms",
  schema: InboundSmsData,
  options: {
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 120,
    localConcurrency: 2,
  },
  handler: (data, deps) => ingestInboundSms(deps, data),
});
