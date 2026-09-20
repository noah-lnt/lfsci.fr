import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../../src/deps";
import { type IcalFetcher, pollIcal } from "../../src/jobs/icalPoll";
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
} from "../db";
import { fakeDeps } from "../fakes";

const run = TEST_DATABASE_URL ? describe : describe.skip;

const BUILDING_ID = "60000000-0000-4000-8000-000000000001";
const UNIT_A = "60000000-0000-4000-8000-000000000002";
const UNIT_B = "60000000-0000-4000-8000-000000000003";
const LISTING_A = "60000000-0000-4000-8000-000000000004";
const LISTING_B = "60000000-0000-4000-8000-000000000005";
const URL_A = "https://calendar.test/a.ics";
const URL_B = "https://calendar.test/b.ics";

const NOW = new Date("2026-09-20T08:00:00.000Z");

function deps(): Deps {
  return fakeDeps({ db: appDb(), admin: adminDb(), now: () => NOW });
}

function calendar(events: { uid: string; start: string; end: string; summary?: string }[]): string {
  const body = events
    .map((event) =>
      [
        "BEGIN:VEVENT",
        `UID:${event.uid}`,
        `DTSTART;VALUE=DATE:${event.start.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${event.end.replaceAll("-", "")}`,
        `SUMMARY:${event.summary ?? "Reserved"}`,
        "END:VEVENT",
      ].join("\r\n"),
    )
    .join("\r\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//FR", body, "END:VCALENDAR"].join(
    "\r\n",
  );
}

/** Feeds are served from a map; a url answering `undefined` throws like a dead host. */
function fetcher(feeds: Record<string, string>): IcalFetcher {
  return async (url) => {
    const body = feeds[url];
    if (body === undefined) throw new Error(`calendrier injoignable: ${url}`);
    return body;
  };
}

async function seedListings(): Promise<void> {
  const db = adminDb().db;
  await db.execute(sql`
    INSERT INTO building (id, organization_id, legal_entity_id, code, name, address_line1)
    VALUES (${BUILDING_ID}::uuid, ${ORG_ID}::uuid, ${ENTITY_ID}::uuid, 'BAT-1', 'Résidence test', '1 rue Exemple')
  `);
  for (const [id, code] of [
    [UNIT_A, "LOT-A1"],
    [UNIT_B, "LOT-B2"],
  ] as const) {
    await db.execute(sql`
      INSERT INTO unit (id, organization_id, building_id, code, label, kind)
      VALUES (${id}::uuid, ${ORG_ID}::uuid, ${BUILDING_ID}::uuid, ${code}, 'Meublé', 'dwelling')
    `);
  }
  await db.execute(sql`
    INSERT INTO listing (id, organization_id, unit_id, platform, external_listing_id, ical_import_url, status)
    VALUES (${LISTING_A}::uuid, ${ORG_ID}::uuid, ${UNIT_A}::uuid, 'airbnb', 'A-1', ${URL_A}, 'active'),
           (${LISTING_B}::uuid, ${ORG_ID}::uuid, ${UNIT_B}::uuid, 'booking', 'B-1', ${URL_B}, 'active')
  `);
}

type BookingRow = {
  external_booking_id: string;
  check_in_on: string;
  check_out_on: string;
  nights: number;
  status: string;
  source: string;
  accommodation_amount: string;
  cleaning_amount: string;
  commission_amount: string;
  refund_amount: string;
  tourist_tax_collected: string;
  tourist_tax_remitted: string;
  deposit_amount: string;
};

async function bookings(): Promise<BookingRow[]> {
  const rows = await adminDb().db.execute<BookingRow>(sql`
    SELECT external_booking_id, check_in_on::text, check_out_on::text, nights, status, source,
           accommodation_amount, cleaning_amount, commission_amount, refund_amount,
           tourist_tax_collected, tourist_tax_remitted, deposit_amount
      FROM booking ORDER BY check_in_on
  `);
  return [...rows];
}

async function lastPolled(listingId: string): Promise<string | null> {
  const rows = await adminDb().db.execute<{ polled: string | null }>(sql`
    SELECT ical_last_polled_at::text AS polled FROM listing WHERE id = ${listingId}::uuid
  `);
  return [...rows][0]?.polled ?? null;
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

  it("writes one blocked booking per calendar block, with every amount at zero", async () => {
    const feeds = {
      [URL_A]: calendar([{ uid: "evt-1", start: "2026-10-02", end: "2026-10-06" }]),
      [URL_B]: calendar([]),
    };

    const outcome = await pollIcal(deps(), fetcher(feeds));

    expect(outcome).toMatchObject({ outcome: "polled", listings: 2, blocks: 1, failures: [] });
    const rows = await bookings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      external_booking_id: "evt-1",
      check_in_on: "2026-10-02",
      // DTEND is exclusive: the departure day is not a night.
      check_out_on: "2026-10-06",
      nights: 4,
      status: "blocked",
      source: "ical",
    });
    // AIR-03: no figure may originate from a calendar.
    expect([
      rows[0]?.accommodation_amount,
      rows[0]?.cleaning_amount,
      rows[0]?.commission_amount,
      rows[0]?.refund_amount,
      rows[0]?.tourist_tax_collected,
      rows[0]?.tourist_tax_remitted,
      rows[0]?.deposit_amount,
    ]).toEqual(["0.00", "0.00", "0.00", "0.00", "0.00", "0.00", "0.00"]);
    expect(await lastPolled(LISTING_A)).not.toBeNull();
  });

  it("re-reading the same feed updates the block instead of adding one", async () => {
    const first = {
      [URL_A]: calendar([{ uid: "evt-1", start: "2026-10-02", end: "2026-10-06" }]),
      [URL_B]: calendar([]),
    };
    await pollIcal(deps(), fetcher(first));

    const moved = {
      [URL_A]: calendar([{ uid: "evt-1", start: "2026-10-03", end: "2026-10-08" }]),
      [URL_B]: calendar([]),
    };
    await pollIcal(deps(), fetcher(moved));

    const rows = await bookings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      check_in_on: "2026-10-03",
      check_out_on: "2026-10-08",
      status: "blocked",
    });
  });

  it("stops blocking dates once the block has left the feed", async () => {
    const before = {
      [URL_A]: calendar([
        { uid: "evt-past", start: "2026-08-01", end: "2026-08-04" },
        { uid: "evt-future", start: "2026-11-02", end: "2026-11-06" },
      ]),
      [URL_B]: calendar([]),
    };
    await pollIcal(deps(), fetcher(before));
    expect((await bookings()).every((row) => row.status === "blocked")).toBe(true);

    const after = { [URL_A]: calendar([]), [URL_B]: calendar([]) };
    const outcome = await pollIcal(deps(), fetcher(after));

    expect(outcome).toMatchObject({ cancelled: 1 });
    const rows = await bookings();
    expect(rows.map((row) => [row.external_booking_id, row.status])).toEqual([
      // A stay already over blocks nothing and is left as it was read.
      ["evt-past", "blocked"],
      ["evt-future", "cancelled"],
    ]);
  });

  it("keeps polling the other listings when one feed is unreachable", async () => {
    const feeds = {
      [URL_B]: calendar([{ uid: "evt-b", start: "2026-10-10", end: "2026-10-12" }]),
    };

    const outcome = await pollIcal(deps(), fetcher(feeds));

    expect(outcome).toMatchObject({ listings: 2, blocks: 1 });
    expect((outcome.failures as string[])[0]).toContain(LISTING_A);
    expect((await bookings()).map((row) => row.external_booking_id)).toEqual(["evt-b"]);
    // A poll that could not look must not read as fresh.
    expect(await lastPolled(LISTING_A)).toBeNull();
    expect(await lastPolled(LISTING_B)).not.toBeNull();
  });

  it("fails the pass when every feed fails, and advances no freshness", async () => {
    await expect(pollIcal(deps(), fetcher({}))).rejects.toThrow(/every calendar failed/);
    expect(await lastPolled(LISTING_A)).toBeNull();
    expect(await lastPolled(LISTING_B)).toBeNull();
  });
});
