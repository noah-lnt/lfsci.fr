import "server-only";
import {
  AvailabilityRead,
  BookingDetail,
  BookingPage,
  CalendarRead,
  CourteDureeLookups,
  ImportPreview,
  ImportResult,
  ListingDetail,
  ListingPage,
  MappingList,
  PayoutDetailRead,
  PayoutPage,
} from "@/lib/contracts/courte-duree";
import {
  availabilityFor,
  availableMappings,
  calendarFor,
  commitImport,
  courteDureeLookups,
  createBooking,
  createListing,
  decidePayout,
  getBooking,
  getListing,
  getPayout,
  listBookings,
  listListings,
  listPayouts,
  previewImport,
  setBookingStatus,
  setListingStatus,
  updateBooking,
  updateListing,
} from "../../courte-duree/repository";
import { tenant } from "../../data";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

type Scoped = RpcContext & { organizationId: string };

function actorOf(context: Scoped) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.session?.user.id ?? null,
  };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

export const courteDureeRouter = {
  courteDuree: {
    lookups: withOrganization.courteDuree.lookups
      .use(validated(CourteDureeLookups))
      .handler(({ context }) => tenant(scope(context), (tx) => courteDureeLookups(tx))),
    listings: {
      list: withOrganization.courteDuree.listings.list
        .use(validated(ListingPage))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listListings(tx, input))),
      get: withOrganization.courteDuree.listings.get
        .use(validated(ListingDetail))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getListing(tx, input.id))),
      create: withOrganization.courteDuree.listings.create
        .use(validated(ListingDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createListing(tx, actorOf(context), input)),
        ),
      update: withOrganization.courteDuree.listings.update
        .use(validated(ListingDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateListing(tx, actorOf(context), input)),
        ),
      setStatus: withOrganization.courteDuree.listings.setStatus
        .use(validated(ListingDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => setListingStatus(tx, actorOf(context), input)),
        ),
    },
    bookings: {
      list: withOrganization.courteDuree.bookings.list
        .use(validated(BookingPage))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listBookings(tx, input))),
      get: withOrganization.courteDuree.bookings.get
        .use(validated(BookingDetail))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getBooking(tx, input.id))),
      create: withOrganization.courteDuree.bookings.create
        .use(validated(BookingDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => createBooking(tx, actorOf(context), input)),
        ),
      update: withOrganization.courteDuree.bookings.update
        .use(validated(BookingDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => updateBooking(tx, actorOf(context), input)),
        ),
      setStatus: withOrganization.courteDuree.bookings.setStatus
        .use(validated(BookingDetail))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => setBookingStatus(tx, actorOf(context), input)),
        ),
      calendar: withOrganization.courteDuree.bookings.calendar
        .use(validated(CalendarRead))
        .handler(({ context, input }) => tenant(scope(context), (tx) => calendarFor(tx, input))),
    },
    availability: {
      get: withOrganization.courteDuree.availability.get
        .use(validated(AvailabilityRead))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => availabilityFor(tx, input.listingId, input)),
        ),
    },
    imports: {
      mappings: withOrganization.courteDuree.imports.mappings
        .use(validated(MappingList))
        .handler(({ input }) => availableMappings(input.kind)),
      preview: withOrganization.courteDuree.imports.preview
        .use(validated(ImportPreview))
        .handler(({ context, input }) => tenant(scope(context), (tx) => previewImport(tx, input))),
      commit: withOrganization.courteDuree.imports.commit
        .use(validated(ImportResult))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => commitImport(tx, actorOf(context), input)),
        ),
    },
    payouts: {
      list: withOrganization.courteDuree.payouts.list
        .use(validated(PayoutPage))
        .handler(({ context, input }) => tenant(scope(context), (tx) => listPayouts(tx, input))),
      get: withOrganization.courteDuree.payouts.get
        .use(validated(PayoutDetailRead))
        .handler(({ context, input }) => tenant(scope(context), (tx) => getPayout(tx, input.id))),
      decide: withOrganization.courteDuree.payouts.decide
        .use(validated(PayoutDetailRead))
        .handler(({ context, input }) =>
          tenant(scope(context), (tx) => decidePayout(tx, actorOf(context), input)),
        ),
    },
  },
};
