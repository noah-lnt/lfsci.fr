import type { Tx } from "@lfsci/db";
import { tables, withTenant } from "@lfsci/db";
import { addDaysIso } from "@lfsci/domain";
import { logger, toAppError } from "@lfsci/kernel";
import { type AvailabilityBlock, fetchIcal, icalAvailability, parseIcal } from "@lfsci/opendata";
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.ical.poll");

export const ICAL_TIME_ZONE = "Europe/Paris";
export const ICAL_TIMEOUT_MS = 15_000;

/**
 * AIR-03: a calendar carries no evidential value for money. Every amount of a
 * booking born from a feed is zero, and no figure may ever originate from one.
 */
export const ICAL_AMOUNTS = {
  accommodationAmount: "0.00",
  cleaningAmount: "0.00",
  commissionAmount: "0.00",
  refundAmount: "0.00",
  touristTaxCollected: "0.00",
  touristTaxRemitted: "0.00",
  depositAmount: "0.00",
} as const;

export const IcalPollData = JobBase.extend({});
export type IcalPollData = z.infer<typeof IcalPollData>;

export type IcalFetcher = (url: string) => Promise<string>;

type ListingRow = typeof tables.listing.$inferSelect;

export type ListingPoll = { blocks: number; cancelled: number };

function defaultFetcher(): IcalFetcher {
  return (url) => fetchIcal({ url, fetch: globalThis.fetch, timeoutMs: ICAL_TIMEOUT_MS });
}

/**
 * A block already over stops nothing, so it is left as it was read; only a block
 * that still holds dates and has left the feed is cancelled.
 */
async function cancelVanished(
  tx: Tx,
  listing: ListingRow,
  keptUids: string[],
  today: string,
  stamp: string,
): Promise<number> {
  const cancelled = await tx
    .update(tables.booking)
    .set({ status: "cancelled", updatedAt: stamp })
    .where(
      and(
        eq(tables.booking.listingId, listing.id),
        eq(tables.booking.source, "ical"),
        eq(tables.booking.status, "blocked"),
        isNotNull(tables.booking.externalBookingId),
        sql`${tables.booking.checkOutOn} >= ${today}`,
        ...(keptUids.length > 0 ? [notInArray(tables.booking.externalBookingId, keptUids)] : []),
      ),
    )
    .returning({ id: tables.booking.id });
  return cancelled.length;
}

export async function pollListing(
  deps: Deps,
  organizationId: string,
  listing: ListingRow,
  fetcher: IcalFetcher,
): Promise<ListingPoll> {
  const url = listing.icalImportUrl;
  if (!url) return { blocks: 0, cancelled: 0 };

  const calendar = parseIcal(await fetcher(url), { timeZone: ICAL_TIME_ZONE });
  // A zero-night event blocks nothing and `booking` refuses it (check_out > check_in).
  const blocks = icalAvailability(calendar).filter(
    (block: AvailabilityBlock) => block.nights > 0 && block.uid.length > 0,
  );
  if (calendar.skipped.length > 0) {
    log.warn(
      { listingId: listing.id, skipped: calendar.skipped.length },
      "calendar entries refused by the parser",
    );
  }

  const now = deps.now();
  const stamp = now.toISOString();
  const today = stamp.slice(0, 10);

  return withTenant(deps.db, { organizationId }, async (tx) => {
    for (const block of blocks) {
      await tx
        .insert(tables.booking)
        .values({
          organizationId,
          listingId: listing.id,
          unitId: listing.unitId,
          platform: listing.platform,
          externalBookingId: block.uid,
          checkInOn: block.startsOn,
          // `endsOn` is the last occupied night; the departure day is the next one.
          checkOutOn: addDaysIso(block.endsOn, 1),
          status: "blocked",
          source: "ical",
          ...ICAL_AMOUNTS,
        })
        .onConflictDoUpdate({
          target: [
            tables.booking.organizationId,
            tables.booking.platform,
            tables.booking.externalBookingId,
          ],
          set: {
            listingId: listing.id,
            unitId: listing.unitId,
            checkInOn: block.startsOn,
            checkOutOn: addDaysIso(block.endsOn, 1),
            status: "blocked",
            source: "ical",
            ...ICAL_AMOUNTS,
            updatedAt: stamp,
          },
        });
    }

    const cancelled = await cancelVanished(
      tx,
      listing,
      blocks.map((block) => block.uid),
      today,
      stamp,
    );

    // Only a poll that answered moves the freshness the screen shows.
    await tx
      .update(tables.listing)
      .set({ icalLastPolledAt: stamp, updatedAt: stamp })
      .where(eq(tables.listing.id, listing.id));

    return { blocks: blocks.length, cancelled };
  });
}

export async function pollOrganization(
  deps: Deps,
  organizationId: string,
  fetcher: IcalFetcher,
): Promise<{ listings: number; blocks: number; cancelled: number; failures: string[] }> {
  const listings = await withTenant(deps.db, { organizationId }, (tx) =>
    tx.select().from(tables.listing).where(isNotNull(tables.listing.icalImportUrl)),
  );

  let blocks = 0;
  let cancelled = 0;
  const failures: string[] = [];

  for (const listing of listings) {
    try {
      const outcome = await pollListing(deps, organizationId, listing, fetcher);
      blocks += outcome.blocks;
      cancelled += outcome.cancelled;
    } catch (error) {
      // One unreachable feed is not an outage of the others: the pass goes on
      // and the listing keeps its previous freshness.
      const appError = toAppError(error);
      failures.push(`${listing.id}: ${appError.code}`);
      log.warn({ listingId: listing.id, code: appError.code }, "calendar poll failed");
    }
  }

  return { listings: listings.length, blocks, cancelled, failures };
}

export async function pollIcal(deps: Deps, fetcher = defaultFetcher()): Promise<JobOutcome> {
  let listings = 0;
  let blocks = 0;
  let cancelled = 0;
  const failures: string[] = [];

  for (const organizationId of await forEachOrganizationId(deps)) {
    const outcome = await pollOrganization(deps, organizationId, fetcher);
    listings += outcome.listings;
    blocks += outcome.blocks;
    cancelled += outcome.cancelled;
    failures.push(...outcome.failures);
  }

  if (listings > 0 && failures.length === listings) {
    // Every feed failing is a failure of the pass, never a clean empty result.
    throw new Error(`every calendar failed across ${listings} listings: ${failures.join("; ")}`);
  }

  return { outcome: "polled", listings, blocks, cancelled, failures };
}

export const icalPoll = defineJob({
  name: "ical.poll",
  schema: IcalPollData,
  options: {
    retryLimit: 2,
    retryDelay: 300,
    retryBackoff: true,
    retryDelayMax: 1800,
    expireInSeconds: 900,
    localConcurrency: 1,
  },
  // Hourly: the platforms document a periodic refresh and guarantee no latency,
  // so a feed is a calendar aid and never a double-booking guarantee (AIR-03).
  schedule: { cron: "0 * * * *", tz: "Europe/Paris" },
  handler: (_data, deps) => pollIcal(deps),
});
