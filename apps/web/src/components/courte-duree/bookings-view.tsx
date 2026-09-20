"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Field, SectionTitle, SelectField } from "@/components/locations/ui";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BookingRow, CalendarEntry } from "@/lib/contracts/courte-duree";
import { errorPayload, rpc } from "@/lib/rpc";
import { BookingStatusBadge, FeedFreshness, IcalNotice, ModelNotice } from "./ui";

const WEEKDAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."] as const;
const STATUSES = [
  "blocked",
  "pending",
  "confirmed",
  "in_stay",
  "completed",
  "cancelled",
  "disputed",
] as const;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2026, (index ?? 1) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function daysOfMonth(month: string): string[] {
  const [year, index] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year ?? 2026, index ?? 1, 0)).getUTCDate();
  return Array.from(
    { length: count },
    (_value, day) => `${month}-${String(day + 1).padStart(2, "0")}`,
  );
}

function weekIndex(isoDate: string): number {
  return (new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function weeksOf(month: string): (string | null)[][] {
  const days = daysOfMonth(month);
  const first = days[0];
  if (!first) return [];
  const cells: (string | null)[] = Array.from<null>({ length: weekIndex(first) }).fill(null);
  cells.push(...days);
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_value, week) =>
    cells.slice(week * 7, week * 7 + 7),
  );
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
}

type Draft = {
  listingId: string;
  externalBookingId: string;
  checkInOn: string;
  checkOutOn: string;
  guestName: string;
  guestCount: string;
  accommodation: string;
  cleaning: string;
  commission: string;
  taxCollected: string;
  taxRemitted: string;
};

const EMPTY_DRAFT: Draft = {
  listingId: "",
  externalBookingId: "",
  checkInOn: "",
  checkOutOn: "",
  guestName: "",
  guestCount: "",
  accommodation: "",
  cleaning: "",
  commission: "",
  taxCollected: "",
  taxRemitted: "",
};

function amountOrUndefined(value: string): string | undefined {
  return value.trim() === "" ? undefined : value.trim().replace(",", ".");
}

export function BookingsView() {
  const t = useTranslations("courteDuree");
  const client = useQueryClient();
  const [month, setMonth] = useState(currentMonth);
  const [listingId, setListingId] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | undefined>(undefined);

  const days = daysOfMonth(month);
  const from = days[0] ?? `${month}-01`;
  const to = days.at(-1) ?? from;

  const lookups = useQuery({
    queryKey: ["courte-duree", "lookups"],
    queryFn: () => rpc.courteDuree.lookups({}),
  });
  const calendar = useQuery({
    queryKey: ["courte-duree", "calendar", month, listingId],
    queryFn: () =>
      rpc.courteDuree.bookings.calendar({ from, to, ...(listingId ? { listingId } : {}) }),
  });
  const bookings = useQuery({
    queryKey: ["courte-duree", "bookings", listingId, status, search],
    queryFn: () =>
      rpc.courteDuree.bookings.list({
        limit: 100,
        ...(listingId ? { listingId } : {}),
        ...(status ? { status: status as BookingRow["status"] } : {}),
        ...(search ? { search } : {}),
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      rpc.courteDuree.bookings.create({
        listingId: draft.listingId,
        checkInOn: draft.checkInOn,
        checkOutOn: draft.checkOutOn,
        ...(draft.externalBookingId ? { externalBookingId: draft.externalBookingId } : {}),
        ...(draft.guestName ? { guestName: draft.guestName } : {}),
        ...(draft.guestCount ? { guestCount: Number(draft.guestCount) } : {}),
        ...(amountOrUndefined(draft.accommodation)
          ? { accommodationAmount: amountOrUndefined(draft.accommodation) }
          : {}),
        ...(amountOrUndefined(draft.cleaning)
          ? { cleaningAmount: amountOrUndefined(draft.cleaning) }
          : {}),
        ...(amountOrUndefined(draft.commission)
          ? { commissionAmount: amountOrUndefined(draft.commission) }
          : {}),
        ...(amountOrUndefined(draft.taxCollected)
          ? { touristTaxCollected: amountOrUndefined(draft.taxCollected) }
          : {}),
        ...(amountOrUndefined(draft.taxRemitted)
          ? { touristTaxRemitted: amountOrUndefined(draft.taxRemitted) }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(t("bookings.created"));
      setDraft(EMPTY_DRAFT);
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
    },
  });

  const listings = lookups.data?.listings ?? [];
  const entries = calendar.data?.entries ?? [];
  const feeds = calendar.data?.feeds ?? [];

  return (
    <div className="space-y-6">
      <ModelNotice />
      <IcalNotice>{t("ical.pendingJob")}</IcalNotice>

      {feeds.length > 0 ? (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <SectionTitle>{t("ical.lastPolled")}</SectionTitle>
          <ul className="flex flex-wrap gap-3 text-sm">
            {feeds.map((feed) => (
              <li key={feed.listingId} className="flex items-center gap-2">
                <span>{feed.label}</span>
                <FeedFreshness
                  neverPolled={feed.neverPolled}
                  stale={feed.stale}
                  lastPolledAt={feed.lastPolledAt}
                />
                {feed.lastPolledAt ? (
                  <DateValue value={feed.lastPolledAt} withTime className="text-muted-foreground" />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>{t("bookings.calendar")}</SectionTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("bookings.previousMonth")}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <p aria-live="polite" className="min-w-40 text-center text-sm font-medium">
              {monthLabel(month)}
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("bookings.nextMonth")}
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        {calendar.error ? <ErrorBox error={errorPayload(calendar.error)} /> : null}

        <CalendarGrid month={month} entries={entries} />

        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bookings.noEntries")}</p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="booking-search">{t("bookings.filters.search")}</Label>
          <Input
            id="booking-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <SelectField
          id="booking-filter-listing"
          label={t("bookings.filters.listing")}
          value={listingId}
          onChange={setListingId}
          options={[
            { value: "", label: t("bookings.filters.all") },
            ...listings.map((listing) => ({ value: listing.id, label: listing.label })),
          ]}
        />
        <SelectField
          id="booking-filter-status"
          label={t("bookings.filters.status")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: t("bookings.filters.allStatuses") },
            ...STATUSES.map((value) => ({ value, label: t(`bookings.status.${value}`) })),
          ]}
        />
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("bookings.new")}</SectionTitle>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.listingId || !draft.checkInOn || !draft.checkOutOn) {
              setError(t("bookings.form.required"));
              return;
            }
            if (draft.checkOutOn <= draft.checkInOn) {
              setError(t("bookings.form.datesInvalid"));
              return;
            }
            setError(undefined);
            create.mutate();
          }}
        >
          <SelectField
            id="booking-listing"
            label={t("bookings.form.listing")}
            value={draft.listingId}
            onChange={(value) => setDraft({ ...draft, listingId: value })}
            options={listings.map((listing) => ({ value: listing.id, label: listing.label }))}
            error={error}
          />
          <Field id="booking-external" label={t("bookings.form.externalId")}>
            <Input
              id="booking-external"
              value={draft.externalBookingId}
              onChange={(event) => setDraft({ ...draft, externalBookingId: event.target.value })}
            />
          </Field>
          <Field id="booking-guest" label={t("bookings.form.guestName")}>
            <Input
              id="booking-guest"
              value={draft.guestName}
              onChange={(event) => setDraft({ ...draft, guestName: event.target.value })}
            />
          </Field>
          <Field id="booking-check-in" label={t("bookings.form.checkIn")}>
            <Input
              id="booking-check-in"
              type="date"
              value={draft.checkInOn}
              onChange={(event) => setDraft({ ...draft, checkInOn: event.target.value })}
            />
          </Field>
          <Field id="booking-check-out" label={t("bookings.form.checkOut")}>
            <Input
              id="booking-check-out"
              type="date"
              value={draft.checkOutOn}
              onChange={(event) => setDraft({ ...draft, checkOutOn: event.target.value })}
            />
          </Field>
          <Field id="booking-guest-count" label={t("bookings.form.guestCount")}>
            <Input
              id="booking-guest-count"
              type="number"
              min={1}
              value={draft.guestCount}
              onChange={(event) => setDraft({ ...draft, guestCount: event.target.value })}
            />
          </Field>
          <Field id="booking-accommodation" label={t("bookings.form.accommodation")}>
            <Input
              id="booking-accommodation"
              inputMode="decimal"
              className="num"
              value={draft.accommodation}
              onChange={(event) => setDraft({ ...draft, accommodation: event.target.value })}
            />
          </Field>
          <Field id="booking-cleaning" label={t("bookings.form.cleaning")}>
            <Input
              id="booking-cleaning"
              inputMode="decimal"
              className="num"
              value={draft.cleaning}
              onChange={(event) => setDraft({ ...draft, cleaning: event.target.value })}
            />
          </Field>
          <Field id="booking-commission" label={t("bookings.form.commission")}>
            <Input
              id="booking-commission"
              inputMode="decimal"
              className="num"
              value={draft.commission}
              onChange={(event) => setDraft({ ...draft, commission: event.target.value })}
            />
          </Field>
          <Field id="booking-tax-collected" label={t("bookings.form.taxCollected")}>
            <Input
              id="booking-tax-collected"
              inputMode="decimal"
              className="num"
              value={draft.taxCollected}
              onChange={(event) => setDraft({ ...draft, taxCollected: event.target.value })}
            />
          </Field>
          <Field id="booking-tax-remitted" label={t("bookings.form.taxRemitted")}>
            <Input
              id="booking-tax-remitted"
              inputMode="decimal"
              className="num"
              value={draft.taxRemitted}
              onChange={(event) => setDraft({ ...draft, taxRemitted: event.target.value })}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={create.isPending}>
              <Plus aria-hidden="true" />
              {t("bookings.create")}
            </Button>
          </div>
        </form>
        {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}
      </section>

      {bookings.error ? <ErrorBox error={errorPayload(bookings.error)} /> : null}

      {bookings.data && bookings.data.items.length === 0 ? (
        <EmptyState title={t("bookings.title")}>{t("bookings.empty")}</EmptyState>
      ) : null}

      {bookings.data && bookings.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bookings.columns.reference")}</TableHead>
                <TableHead>{t("bookings.columns.listing")}</TableHead>
                <TableHead>{t("bookings.columns.stay")}</TableHead>
                <TableHead>{t("bookings.columns.nights")}</TableHead>
                <TableHead>{t("bookings.columns.guest")}</TableHead>
                <TableHead>{t("bookings.columns.net")}</TableHead>
                <TableHead>{t("bookings.columns.payouts")}</TableHead>
                <TableHead>{t("bookings.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.data.items.map((booking) => (
                <TableRow key={booking.id} data-testid="booking-row">
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/locations/courte-duree/reservations/${booking.id}`}
                    >
                      {booking.externalBookingId ?? booking.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>{booking.listingLabel}</TableCell>
                  <TableCell>
                    <DateValue value={booking.stay.checkInOn} /> →{" "}
                    <DateValue value={booking.stay.checkOutOn} />
                  </TableCell>
                  <TableCell className="num">{booking.stay.nights}</TableCell>
                  <TableCell>{booking.stay.guestName ?? t("empty")}</TableCell>
                  <TableCell>
                    <Money amount={booking.line.net} currency={booking.currency} />
                  </TableCell>
                  <TableCell className="num">{booking.payoutCount}</TableCell>
                  <TableCell>
                    <BookingStatusBadge status={booking.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function CalendarGrid({ month, entries }: { month: string; entries: CalendarEntry[] }) {
  const t = useTranslations("courteDuree");
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    for (const day of daysOfMonth(month)) {
      if (day < entry.startsOn || day > entry.endsOn) continue;
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm" data-testid="booking-calendar">
        <caption className="sr-only">{t("bookings.calendarCaption")}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="p-1 text-xs font-medium text-muted-foreground"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(month).map((week) => (
            <tr key={week.find((day) => day !== null) ?? month}>
              {week.map((day, index) => (
                <td
                  key={day ?? `empty-${index}`}
                  className="h-20 border p-1 align-top"
                  data-testid={day ? "calendar-day" : undefined}
                >
                  {day ? (
                    <>
                      <span className="num text-xs text-muted-foreground">
                        {Number(day.slice(8))}
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {(byDay.get(day) ?? []).slice(0, 2).map((entry) => (
                          <li
                            key={entry.bookingId}
                            className="truncate rounded bg-primary/10 px-1 text-xs text-foreground"
                          >
                            {entry.label ?? entry.listingLabel}
                            {entry.source === "ical" ? ` · ${t("bookings.source.ical")}` : ""}
                          </li>
                        ))}
                        {(byDay.get(day) ?? []).length > 2 ? (
                          <li className="px-1 text-xs text-muted-foreground">
                            +{(byDay.get(day) ?? []).length - 2}
                          </li>
                        ) : null}
                      </ul>
                    </>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
