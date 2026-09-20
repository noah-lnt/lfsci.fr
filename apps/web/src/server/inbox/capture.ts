import "server-only";
import type { ObjectKind, Tx } from "@lfsci/db";
import { ensureObjectRef, linkActivity, recordAudit } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type { InboxRow } from "@/lib/contracts/inbox";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import { readRow, toRow } from "./queries";

export type CaptureInput = {
  text: string;
  channel: "note" | "sms";
  declaredAuthor?: string | undefined;
  about?: { kind: string; id: string } | undefined;
};

/** CAP-01: a capture is saved without choosing its object; it lands in the inbox. */
export async function captureNote(scope: TenantScope, input: CaptureInput): Promise<InboxRow> {
  const organizationId = scope.organizationId;
  const actorId = scope.session?.user.id ?? null;

  return tenant(scope, async (tx) => {
    const activityId = await insertActivity(tx, organizationId, input, actorId);

    let objectRefId: string | null = null;
    if (input.about) {
      objectRefId = await ensureObjectRef(tx, {
        organizationId,
        kind: input.about.kind as ObjectKind,
        id: input.about.id,
      });
      await linkActivity(tx, { organizationId, activityId, objectRefId });
    }

    const inserted = [
      ...(await tx.execute<{ id: string }>(sql`
        INSERT INTO inbox_item (organization_id, activity_id, source, proposed_object_ref_id, status)
        VALUES (${organizationId}::uuid, ${activityId}::uuid,
                ${input.channel === "sms" ? "sms_paste" : "mobile_capture"},
                ${objectRefId}::uuid,
                ${objectRefId ? "analyzed" : "received"})
        RETURNING id`)),
    ];
    const row = inserted[0];
    if (!row) throw new AppError("CONFLICT", { message: "inbox_item insert returned no row" });

    await recordAudit(tx, {
      organizationId,
      actorKind: actorId ? "user" : "system",
      actorUserId: actorId,
      objectTable: "inbox_item",
      objectId: row.id,
      action: "inbox.capture",
      afterValue: { channel: input.channel, about: input.about ?? null },
    });

    return toRow(await readRow(tx, row.id));
  });
}

async function insertActivity(
  tx: Tx,
  organizationId: string,
  input: CaptureInput,
  actorId: string | null,
): Promise<string> {
  const inserted = [
    ...(await tx.execute<{ id: string }>(sql`
      INSERT INTO activity (organization_id, channel, direction, body_raw, declared_author,
                            author_user_id, occurred_at)
      VALUES (${organizationId}::uuid, ${input.channel}, 'inbound', ${input.text},
              ${input.declaredAuthor ?? null}, ${actorId}::uuid, now())
      RETURNING id`)),
  ];
  const row = inserted[0];
  if (!row) throw new AppError("CONFLICT", { message: "activity insert returned no row" });
  return row.id;
}
