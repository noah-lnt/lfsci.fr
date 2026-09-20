import { withoutTenant } from "@lfsci/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/deps";
import { ICAL_AMOUNTS, type IcalFetcher, pollIcal, pollOrganization } from "../src/jobs/icalPoll";
import {
  adminDb,
  appDb,
  closeDbs,
  ENTITY_ID,
  migrate,
  ORG_ID,
  seedOrganization,
  TEST_DATABASE_URL,
  truncateAll,
} from "./db";
import { fakeDeps } from "./fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const BUILDING_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const UNIT_ID = "22222222-aaaa-4aaa-8aaa-222222222222";
const LISTING_A = "33333333-aaaa-4aaa-8aaa-333333333333";
const LISTING_B = "44444444-aaaa-4aaa-8aaa-444444444444";
const URL_A = "https://calendar.example.test/a.ics";
const URL_B = "https://calendar.example.test/b.ics";

function deps(): Deps {
  return fakeDeps({
    db: appDb(),
    admin: adminDb(),
    now: () => new Date("2026-09-20T08:00:00.000Z"),
  });
}

async function exec(query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  return withoutTenant(adminDb(), async (tx) => [...(await tx.execute(query))]);
}

function event(uid: string, start: string, end: string): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    "SUMMARY:Reserved",
    "END:VEVENT",
  ].join("\r\n");
}

function calendar(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//", ...events, "END:VCALENDAR"].join(
    "\r\n",
  );
}

async function seedListings(): Promise<void> {
  await exec(sql`
    INSERT INTO building (id, organization_id, legal_entity_id, code, name, address_line1)
    VALUES (${BUILDING_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'B1', 'Immeuble', '1 rue Test')`);
  await exec(sql`
    INSERT INTO unit (id, organization_id, building_id, code, label, kind)
    VALUES (${UNIT_ID}::uuid, ${ORG_ID}::uuid, ${BUILDING_ID}::uuid, 'L1', 'Studio', 'dwelling')`);
  await exec(sql`
    INSERT INTO listing (id, organization_id, unit_id, platform, ical_import_url, status)
    VALUES (${LISTING_A}::uuid, ${ORG_ID}::uuid, ${UNIT_ID}::uuid, 'airbnb', ${URL_A}, 'active'),
           (${LISTING_B}::uuid, ${ORG_ID}::uuid, ${UNIT_ID}::uuid, 'booking', ${URL_B}, 'active')`);
}

async function bookings(): Promise<Record<string, unknown>[]> {
  return exec(sql`
    SELECT listing_id, external_booking_id, check_in_on::text AS check_in_on,
           check_out_on::text AS check_out_on, status, source,
           accommodation_amount::text AS accommodation_amount,
           cleaning_amount::text AS cleaning_amount,
           commission_amount::text AS commission_amount
      FROM booking ORDER BY external_booking_id`);
}

async function polledAt(listingId: string): Promise<string | null> {
  const rows = await exec(
    sql`SELECT ical_last_polled_at::text AS at FROM listing WHERE id = ${listingId}::uuid`,
  );
  return (rows[0]?.at as string | null) ?? null;
}

function fetcherFor(feeds: Record<string, string | Error>): IcalFetcher {
  return async (url) => {
    const feed = feeds[url];
    if (feed === undefined) throw new Error(`unexpected url ${url}`);
    if (feed instanceof Error) throw feed;
    return feed;
  };
}

run("ical.poll", () => {
  beforeAll(async () => {
    await migrate();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrganization();
    await seedListings();
  });

  afterAll(async () => {
    await closeDbs();
  });

  it("writes one blocked booking per calendar block with every amount at zero", async () => {
    const fetcher = fetcherFor({
      [URL_A]: calendar(event("uid-1", "20261001", "20261004")),
      [URL_B]: calendar(),
    });

    const outcome = await pollOrganization(deps(), ORG_ID, fetcher);

    expect(outcome).toMatchObject({ listings: 2, blocks: 1, cancelled: 0, failures: [] });
    const rows = await bookings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      listing_id: LISTING_A,
      external_booking_id: "uid-1",
      check_in_on: "2026-10-01",
      check_out_on: "2026-10-04",
      status: "blocked",
      source: "ical",
      accommodation_amount: "0.00",
      cleaning_amount: "0.00",
      commission_amount: "0.00",
    });
    expect(Object.values(ICAL_AMOUNTS).every((amount) => amount === "0.00")).toBe(true);
    expect(await polledAt(LISTING_A)).not.toBeNull();
  });

  it("keeps polling the other listings when one feed fails, and leaves its freshness alone", async () => {
    const fetcher = fetcherFor({
      [URL_A]: new Error("ECONNRESET"),
      [URL_B]: calendar(event("uid-b", "20261110", "20261112")),
    });

    const outcome = await pollOrganization(deps(), ORG_ID, fetcher);

    expect(outcome.blocks).toBe(1);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]).toContain(LISTING_A);
    expect(await polledAt(LISTING_A)).toBeNull();
    expect(await polledAt(LISTING_B)).not.toBeNull();
  });

  it("fails the pass only when every feed failed", async () => {
    const allDown = fetcherFor({ [URL_A]: new Error("down"), [URL_B]: new Error("down") });
    await expect(pollIcal(deps(), allDown)).rejects.toThrow(/every calendar failed/);

    const oneUp = fetcherFor({ [URL_A]: new Error("down"), [URL_B]: calendar() });
    await expect(pollIcal(deps(), oneUp)).resolves.toMatchObject({ outcome: "polled" });
  });

  it("cancels a future block that left the feed and keeps a past one as history", async () => {
    const first = fetcherFor({
      [URL_A]: calendar(
        event("past", "20260801", "20260803"),
        event("future", "20261201", "20261203"),
      ),
      [URL_B]: calendar(),
    });
    await pollOrganization(deps(), ORG_ID, first);

    const second = fetcherFor({ [URL_A]: calendar(), [URL_B]: calendar() });
    const outcome = await pollOrganization(deps(), ORG_ID, second);

    expect(outcome.cancelled).toBe(1);
    const byUid = Object.fromEntries(
      (await bookings()).map((row) => [row.external_booking_id, row]),
    );
    expect(byUid.past?.status).toBe("blocked");
    expect(byUid.future?.status).toBe("cancelled");
  });

  it("is idempotent: the same feed twice moves the dates, never duplicates the row", async () => {
    const fetcher = fetcherFor({
      [URL_A]: calendar(event("uid-1", "20261001", "20261004")),
      [URL_B]: calendar(),
    });
    await pollOrganization(deps(), ORG_ID, fetcher);

    const moved = fetcherFor({
      [URL_A]: calendar(event("uid-1", "20261002", "20261005")),
      [URL_B]: calendar(),
    });
    await pollOrganization(deps(), ORG_ID, moved);

    const rows = await bookings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ check_in_on: "2026-10-02", check_out_on: "2026-10-05" });
  });
});
