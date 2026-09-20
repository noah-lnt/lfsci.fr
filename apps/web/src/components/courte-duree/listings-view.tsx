"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListingRow } from "@/lib/contracts/courte-duree";
import { errorPayload, rpc } from "@/lib/rpc";
import { FeedFreshness, IcalNotice, ListingStatusBadge, ModelNotice } from "./ui";

const PLATFORMS = ["airbnb", "booking", "abritel", "direct", "other"] as const;
const STATUSES = ["draft", "active", "paused", "archived"] as const;

type Draft = {
  unitId: string;
  platform: string;
  title: string;
  externalListingId: string;
  icalImportUrl: string;
  icalExportUrl: string;
  registrationNumber: string;
  registrationCheckedOn: string;
};

const EMPTY_DRAFT: Draft = {
  unitId: "",
  platform: "airbnb",
  title: "",
  externalListingId: "",
  icalImportUrl: "",
  icalExportUrl: "",
  registrationNumber: "",
  registrationCheckedOn: "",
};

export function ListingsView() {
  const t = useTranslations("courteDuree");
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | undefined>(undefined);
  const [edited, setEdited] = useState<ListingRow | null>(null);

  const lookups = useQuery({
    queryKey: ["courte-duree", "lookups"],
    queryFn: () => rpc.courteDuree.lookups({}),
  });
  const listings = useQuery({
    queryKey: ["courte-duree", "listings", search, status],
    queryFn: () =>
      rpc.courteDuree.listings.list({
        limit: 100,
        ...(search ? { search } : {}),
        ...(status ? { status: status as ListingRow["status"] } : {}),
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      rpc.courteDuree.listings.create({
        unitId: draft.unitId,
        platform: draft.platform as ListingRow["platform"],
        ...(draft.title ? { title: draft.title } : {}),
        ...(draft.externalListingId ? { externalListingId: draft.externalListingId } : {}),
        ...(draft.icalImportUrl ? { icalImportUrl: draft.icalImportUrl } : {}),
        ...(draft.icalExportUrl ? { icalExportUrl: draft.icalExportUrl } : {}),
        ...(draft.registrationNumber ? { registrationNumber: draft.registrationNumber } : {}),
        ...(draft.registrationCheckedOn
          ? { registrationCheckedOn: draft.registrationCheckedOn }
          : {}),
        status: "active",
      }),
    onSuccess: async () => {
      toast.success(t("listings.created"));
      setDraft(EMPTY_DRAFT);
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
    },
  });

  const units = lookups.data?.units ?? [];

  return (
    <div className="space-y-6">
      <ModelNotice />
      <IcalNotice />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="listing-search">{t("bookings.filters.search")}</Label>
          <Input
            id="listing-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <SelectField
          id="listing-filter-status"
          label={t("listings.form.status")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: t("payouts.filters.all") },
            ...STATUSES.map((value) => ({ value, label: t(`listings.status.${value}`) })),
          ]}
        />
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("listings.new")}</SectionTitle>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.unitId) {
              setError(t("listings.form.required"));
              return;
            }
            setError(undefined);
            create.mutate();
          }}
        >
          <SelectField
            id="listing-unit"
            label={t("listings.form.unit")}
            value={draft.unitId}
            onChange={(value) => setDraft({ ...draft, unitId: value })}
            options={units.map((unit) => ({ value: unit.id, label: unit.label }))}
            error={error}
          />
          <SelectField
            id="listing-platform"
            label={t("listings.form.platform")}
            value={draft.platform}
            onChange={(value) => setDraft({ ...draft, platform: value })}
            options={PLATFORMS.map((value) => ({ value, label: t(`platform.${value}`) }))}
          />
          <Field id="listing-title" label={t("listings.form.title")}>
            <Input
              id="listing-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </Field>
          <Field id="listing-external" label={t("listings.form.externalId")}>
            <Input
              id="listing-external"
              value={draft.externalListingId}
              onChange={(event) => setDraft({ ...draft, externalListingId: event.target.value })}
            />
          </Field>
          <Field id="listing-ical-import" label={t("listings.form.icalImportUrl")}>
            <Input
              id="listing-ical-import"
              type="url"
              value={draft.icalImportUrl}
              onChange={(event) => setDraft({ ...draft, icalImportUrl: event.target.value })}
            />
          </Field>
          <Field id="listing-ical-export" label={t("listings.form.icalExportUrl")}>
            <Input
              id="listing-ical-export"
              type="url"
              value={draft.icalExportUrl}
              onChange={(event) => setDraft({ ...draft, icalExportUrl: event.target.value })}
            />
          </Field>
          <Field
            id="listing-registration"
            label={t("listings.form.registrationNumber")}
            hint={t("listings.registrationHint")}
          >
            <Input
              id="listing-registration"
              value={draft.registrationNumber}
              onChange={(event) => setDraft({ ...draft, registrationNumber: event.target.value })}
            />
          </Field>
          <Field id="listing-checked-on" label={t("listings.form.registrationCheckedOn")}>
            <Input
              id="listing-checked-on"
              type="date"
              value={draft.registrationCheckedOn}
              onChange={(event) =>
                setDraft({ ...draft, registrationCheckedOn: event.target.value })
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              <Plus aria-hidden="true" />
              {t("listings.create")}
            </Button>
          </div>
        </form>
        {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}
      </section>

      {listings.error ? <ErrorBox error={errorPayload(listings.error)} /> : null}

      {listings.data && listings.data.items.length === 0 ? (
        <EmptyState title={t("listings.title")}>{t("listings.empty")}</EmptyState>
      ) : null}

      {listings.data && listings.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("listings.columns.title")}</TableHead>
                <TableHead>{t("listings.columns.unit")}</TableHead>
                <TableHead>{t("listings.columns.platform")}</TableHead>
                <TableHead>{t("listings.columns.registration")}</TableHead>
                <TableHead>{t("listings.columns.bookings")}</TableHead>
                <TableHead>{t("listings.columns.nextCheckIn")}</TableHead>
                <TableHead>{t("listings.columns.ical")}</TableHead>
                <TableHead>{t("listings.columns.status")}</TableHead>
                <TableHead>{t("listings.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings.data.items.map((listing) => (
                <TableRow key={listing.id} data-testid="listing-row">
                  <TableCell className="font-medium">
                    {listing.title ?? t("empty")}
                    {listing.externalListingId ? (
                      <span className="block text-xs text-muted-foreground">
                        {listing.externalListingId}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{listing.unitLabel}</TableCell>
                  <TableCell>{t(`platform.${listing.platform}`)}</TableCell>
                  <TableCell>
                    {listing.registrationNumber ?? t("empty")}
                    {listing.registrationCheckedOn ? (
                      <span className="block text-xs text-muted-foreground">
                        {t("listings.columns.checkedOn")}{" "}
                        <DateValue value={listing.registrationCheckedOn} />
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="num">{listing.bookingCount}</TableCell>
                  <TableCell>
                    <DateValue value={listing.nextCheckInOn} />
                  </TableCell>
                  <TableCell>
                    {listing.icalImportUrl ? (
                      <FeedFreshness
                        neverPolled={listing.icalLastPolledAt === null}
                        stale={listing.icalLastPolledAt === null}
                        lastPolledAt={listing.icalLastPolledAt}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("ical.noFeed")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ListingStatusBadge status={listing.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="listing-edit"
                      onClick={() => setEdited(listing)}
                    >
                      {t("listings.edit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <ListingSheet listing={edited} onClose={() => setEdited(null)} />
    </div>
  );
}

function ListingSheet({ listing, onClose }: { listing: ListingRow | null; onClose: () => void }) {
  const t = useTranslations("courteDuree");
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationCheckedOn, setRegistrationCheckedOn] = useState("");
  const [icalImportUrl, setIcalImportUrl] = useState("");
  const [target, setTarget] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);

  if (listing && loaded !== listing.id) {
    setLoaded(listing.id);
    setTitle(listing.title ?? "");
    setRegistrationNumber(listing.registrationNumber ?? "");
    setRegistrationCheckedOn(listing.registrationCheckedOn ?? "");
    setIcalImportUrl(listing.icalImportUrl ?? "");
    setTarget("");
  }

  const update = useMutation({
    mutationFn: () =>
      rpc.courteDuree.listings.update({
        id: listing?.id ?? "",
        expectedVersion: listing?.version ?? 1,
        title: title === "" ? null : title,
        registrationNumber: registrationNumber === "" ? null : registrationNumber,
        registrationCheckedOn: registrationCheckedOn === "" ? null : registrationCheckedOn,
        icalImportUrl: icalImportUrl === "" ? null : icalImportUrl,
      }),
    onSuccess: async () => {
      toast.success(t("listings.updated"));
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
      onClose();
    },
  });

  const availability = useQuery({
    queryKey: ["courte-duree", "availability", listing?.id],
    queryFn: () => rpc.courteDuree.availability.get({ listingId: listing?.id ?? "" }),
    enabled: listing !== null,
  });

  const changeStatus = useMutation({
    mutationFn: () =>
      rpc.courteDuree.listings.setStatus({
        id: listing?.id ?? "",
        expectedVersion: listing?.version ?? 1,
        status: target as ListingRow["status"],
      }),
    onSuccess: async () => {
      toast.success(t("listings.statusChanged"));
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
      onClose();
    },
  });

  const transitions = listing ? TRANSITIONS[listing.status] : [];

  return (
    <Sheet open={listing !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{listing?.title ?? t("listings.title")}</SheetTitle>
          <SheetDescription>{listing?.unitLabel ?? ""}</SheetDescription>
        </SheetHeader>

        <form
          className="space-y-4 px-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate();
          }}
        >
          <Field id="edit-listing-title" label={t("listings.form.title")}>
            <Input
              id="edit-listing-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field
            id="edit-listing-registration"
            label={t("listings.form.registrationNumber")}
            hint={t("listings.registrationHint")}
          >
            <Input
              id="edit-listing-registration"
              value={registrationNumber}
              onChange={(event) => setRegistrationNumber(event.target.value)}
            />
          </Field>
          <Field id="edit-listing-checked-on" label={t("listings.form.registrationCheckedOn")}>
            <Input
              id="edit-listing-checked-on"
              type="date"
              value={registrationCheckedOn}
              onChange={(event) => setRegistrationCheckedOn(event.target.value)}
            />
          </Field>
          <Field id="edit-listing-ical" label={t("listings.form.icalImportUrl")}>
            <Input
              id="edit-listing-ical"
              type="url"
              value={icalImportUrl}
              onChange={(event) => setIcalImportUrl(event.target.value)}
            />
          </Field>
          <Button type="submit" data-testid="listing-save" disabled={update.isPending}>
            {t("listings.save")}
          </Button>
          {update.error ? <ErrorBox error={errorPayload(update.error)} /> : null}
        </form>

        <div className="space-y-3 px-4" data-testid="listing-availability">
          <SectionTitle>{t("ical.blocks")}</SectionTitle>
          <p className="text-xs text-muted-foreground">{t("ical.text")}</p>
          {availability.data ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FeedFreshness
                  neverPolled={availability.data.neverPolled}
                  stale={availability.data.stale}
                  lastPolledAt={availability.data.lastPolledAt}
                />
                {availability.data.lastPolledAt ? (
                  <DateValue value={availability.data.lastPolledAt} withTime />
                ) : (
                  <span className="text-muted-foreground">{t("ical.pendingJob")}</span>
                )}
              </div>
              {availability.data.blocks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ical.noBlocks")}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {availability.data.blocks.map((block) => (
                    <li key={block.reference} data-testid="availability-block">
                      <DateValue value={block.startsOn} /> → <DateValue value={block.endsOn} /> ·{" "}
                      {block.nights} {t("ical.nights")} ·{" "}
                      {t(`bookings.source.${block.source ?? "manual"}`)}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </div>

        <div className="space-y-3 px-4 pb-6">
          <SectionTitle>{t("listings.statusAction")}</SectionTitle>
          <SelectField
            id="listing-transition"
            label={t("listings.form.status")}
            value={target}
            onChange={setTarget}
            options={transitions.map((value) => ({
              value,
              label: t(`listings.status.${value}`),
            }))}
            disabled={transitions.length === 0}
            hint={transitions.length === 0 ? t("listings.noTransition") : undefined}
          />
          <Button
            variant="outline"
            data-testid="listing-transition-apply"
            disabled={target === "" || changeStatus.isPending}
            onClick={() => changeStatus.mutate()}
          >
            {t("listings.apply")}
          </Button>
          {changeStatus.error ? <ErrorBox error={errorPayload(changeStatus.error)} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const TRANSITIONS: Record<ListingRow["status"], ListingRow["status"][]> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: ["active"],
};
