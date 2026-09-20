import type { OutboxRow } from "@lfsci/db";
import { withoutTenant } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import type { Mailer, OutboundEmail } from "@lfsci/mail";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/deps";
import { dispatchEmailEntry, dispatchEmailOnce } from "../src/jobs/emailDispatch";
import {
  adminDb,
  appDb,
  closeDbs,
  migrate,
  ORG_ID,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "./db";
import { fakeDeps } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const DEDUP_KEY = "reminder:lease-1:reminder_1:2026-08-11";

function deps(): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb() });
}

async function exec(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return withoutTenant(adminDb(), async (tx) => [...(await tx.execute(query))]);
}

type MailerSpy = Mailer & { calls: OutboundEmail[] };

function fakeMailer(
  respond: (email: OutboundEmail) => Promise<{ id: string }> = async () => ({ id: "e_1" }),
): MailerSpy {
  const calls: OutboundEmail[] = [];
  return {
    calls,
    async send(email) {
      calls.push(email);
      return respond(email);
    },
  };
}

async function seedMessage(
  overrides: { status?: string; providerMessageId?: string | null } = {},
): Promise<string> {
  const rows = await exec(sql`
    INSERT INTO message_outbound (organization_id, channel, recipient_address, subject, body,
                                  template_code, template_version, status, dedup_key,
                                  provider, provider_message_id)
    VALUES (${ORG_ID}::uuid, 'email', 'camille@example.test', 'Loyer en attente',
            'Bonjour, la somme de 780,00 EUR reste due.', 'rent_reminder_simple', '2026-09-20.1',
            ${overrides.status ?? "approved"}, ${DEDUP_KEY},
            ${overrides.providerMessageId ? "resend" : null},
            ${overrides.providerMessageId ?? null})
    RETURNING id`);
  return String(rows[0]?.id);
}

/** The raw insert returns snake_case; the job reads the drizzle row shape. */
async function seedEntry(messageId: string): Promise<OutboxRow> {
  const rows = await exec(sql`
    INSERT INTO outbox_entry (organization_id, message_outbound_id, channel, partition_key,
                              payload, payload_hash, status, available_at)
    VALUES (${ORG_ID}::uuid, ${messageId}::uuid, 'email', ${messageId}, '{}'::jsonb,
            'x', 'pending', now())
    RETURNING id, organization_id, message_outbound_id, command_id, channel, attempts,
              lease_generation`);
  const row = rows[0] as Record<string, string | number>;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    messageOutboundId: String(row.message_outbound_id),
    commandId: null,
    channel: "email",
    attempts: Number(row.attempts),
    leaseGeneration: Number(row.lease_generation),
  } as OutboxRow;
}

async function messageRow(id: string): Promise<Record<string, unknown>> {
  const rows = await exec(sql`SELECT * FROM message_outbound WHERE id = ${id}::uuid`);
  return rows[0] as Record<string, unknown>;
}

async function entryRow(id: string): Promise<Record<string, unknown>> {
  const rows = await exec(sql`SELECT * FROM outbox_entry WHERE id = ${id}::uuid`);
  return rows[0] as Record<string, unknown>;
}

run("email.dispatch", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("writes the attempt trace before the send and the provider id after it", async () => {
    const messageId = await seedMessage();
    const entry = await seedEntry(messageId);

    let seenDuringSend: Record<string, unknown> | undefined;
    const mailer = fakeMailer(async () => {
      seenDuringSend = await messageRow(messageId);
      return { id: "e_42" };
    });

    await expect(dispatchEmailEntry(deps(), entry, mailer)).resolves.toBe("sent");

    // The irreversible effect only happens once its trace is committed.
    expect(seenDuringSend).toMatchObject({
      status: "queued",
      attempts: 1,
      provider: "resend",
      provider_message_id: null,
    });
    expect(seenDuringSend?.first_attempt_at).not.toBeNull();

    expect(mailer.calls[0]).toMatchObject({
      to: ["camille@example.test"],
      idempotencyKey: DEDUP_KEY,
    });
    expect(await messageRow(messageId)).toMatchObject({
      status: "sent",
      provider_message_id: "e_42",
      error_code: null,
    });
    expect(await entryRow(String(entry.id))).toMatchObject({ status: "confirmed" });
  });

  it("never sends a message twice for the same dedup key", async () => {
    const messageId = await seedMessage({ status: "sent", providerMessageId: "e_first" });
    // The guard reads columns that are really on the row, so it cannot be vacuously false.
    const before = await messageRow(messageId);
    expect(before.dedup_key).toBe(DEDUP_KEY);
    expect(before.provider_message_id).toBe("e_first");

    const entry = await seedEntry(messageId);
    const mailer = fakeMailer();

    await expect(dispatchEmailEntry(deps(), entry, mailer)).resolves.toBe("duplicate");

    expect(mailer.calls).toHaveLength(0);
    expect(await messageRow(messageId)).toMatchObject({
      status: "sent",
      provider_message_id: "e_first",
      attempts: 0,
    });
    expect(await entryRow(String(entry.id))).toMatchObject({ status: "sent" });
  });

  it("retries a provider outage without dead-lettering it", async () => {
    const messageId = await seedMessage();
    const entry = await seedEntry(messageId);
    const mailer = fakeMailer(async () => {
      throw new AppError("UPSTREAM_UNAVAILABLE", { message: "service unavailable" });
    });

    await expect(dispatchEmailEntry(deps(), entry, mailer)).resolves.toBe("retry");

    expect(await messageRow(messageId)).toMatchObject({
      status: "queued",
      error_code: "UPSTREAM_UNAVAILABLE",
      provider_message_id: null,
    });
    const row = await entryRow(String(entry.id));
    expect(row).toMatchObject({ status: "pending" });
    expect(String(row.last_error)).toContain("UPSTREAM_UNAVAILABLE");
    expect(new Date(String(row.available_at)).getTime()).toBeGreaterThan(Date.now());
    expect(await exec(sql`SELECT id FROM inbox_item`)).toEqual([]);
  });

  it("makes a rejected recipient terminal and visible", async () => {
    const messageId = await seedMessage();
    const entry = await seedEntry(messageId);
    const mailer = fakeMailer(async () => {
      throw new AppError("UPSTREAM_REJECTED", { message: "Invalid `to` field" });
    });

    await expect(dispatchEmailEntry(deps(), entry, mailer)).resolves.toBe("rejected");

    expect(await messageRow(messageId)).toMatchObject({
      status: "failed",
      error_code: "UPSTREAM_REJECTED",
      provider_message_id: null,
    });
    expect(await entryRow(String(entry.id))).toMatchObject({ status: "dead_letter" });
    const exceptions = await exec(sql`SELECT * FROM inbox_item`);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]).toMatchObject({ proposed_action: "review_message_rejected" });
    expect(String(exceptions[0]?.uncertainty_reason)).toContain("camille@example.test");
  });

  it("claims only the email channel and leaves the odoo queue alone", async () => {
    const messageId = await seedMessage();
    await seedEntry(messageId);
    await exec(sql`
      INSERT INTO outbox_entry (organization_id, channel, partition_key, payload, payload_hash,
                                status, available_at)
      VALUES (${ORG_ID}::uuid, 'odoo', 'other', '{}'::jsonb, 'y', 'pending', now())`);

    const mailer = fakeMailer(async () => ({ id: "e_7" }));
    const outcome = await dispatchEmailOnce(deps(), 20, mailer);

    expect(outcome).toMatchObject({ outcome: "processed", claimed: 1, sent: 1 });
    expect(await exec(sql`SELECT status FROM outbox_entry WHERE channel = 'odoo'`)).toEqual([
      { status: "pending" },
    ]);
  });

  it("holds the message when no provider is configured", async () => {
    const messageId = await seedMessage();
    const entry = await seedEntry(messageId);

    await expect(dispatchEmailEntry(deps(), entry, null)).resolves.toBe("retry");
    expect(await messageRow(messageId)).toMatchObject({ status: "approved", attempts: 0 });
  });
});
