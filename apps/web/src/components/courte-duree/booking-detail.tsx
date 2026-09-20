"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { PageNav } from "@/components/layout/page-nav";
import { DefinitionList, SectionTitle, SelectField } from "@/components/locations/ui";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BookingDetail } from "@/lib/contracts/courte-duree";
import { errorPayload, rpc } from "@/lib/rpc";
import { BookingStatusBadge, ModelNotice, Notice, PayoutStatusBadge } from "./ui";

export function BookingDetailView({ bookingId }: { bookingId: string }) {
  const t = useTranslations("courteDuree");
  const client = useQueryClient();
  const [target, setTarget] = useState("");

  const booking = useQuery({
    queryKey: ["courte-duree", "booking", bookingId],
    queryFn: () => rpc.courteDuree.bookings.get({ id: bookingId }),
  });

  const transition = useMutation({
    mutationFn: () =>
      rpc.courteDuree.bookings.setStatus({
        id: bookingId,
        expectedVersion: booking.data?.version ?? 1,
        status: target as BookingDetail["status"],
      }),
    onSuccess: async () => {
      toast.success(t("bookings.statusChanged"));
      setTarget("");
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
    },
  });

  if (booking.error) return <ErrorBox error={errorPayload(booking.error)} />;
  if (!booking.data) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  const data = booking.data;

  return (
    <>
      <PageNav
        title={data.externalBookingId ?? data.id.slice(0, 8)}
        description={data.listingLabel}
        icon={<CalendarDays className="size-5" aria-hidden="true" />}
      >
        <BookingStatusBadge status={data.status} />
        <LinkButton href="/locations/courte-duree/reservations" variant="outline" size="sm">
          <ArrowLeft aria-hidden="true" />
          {t("bookings.detail.back")}
        </LinkButton>
      </PageNav>

      <ModelNotice />

      <Tabs defaultValue="booking">
        <TabsList>
          <TabsTrigger value="booking">{t("bookings.tabs.booking")}</TabsTrigger>
          <TabsTrigger value="stay">{t("bookings.tabs.stay")}</TabsTrigger>
          <TabsTrigger value="payouts">{t("bookings.tabs.payouts")}</TabsTrigger>
          <TabsTrigger value="movements">{t("bookings.tabs.movements")}</TabsTrigger>
        </TabsList>

        <TabsContent value="booking" className="space-y-6 pt-4">
          <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="booking-money">
            <SectionTitle>{t("bookings.tabs.booking")}</SectionTitle>
            <DefinitionList
              rows={[
                { label: t("bookings.detail.reference"), value: data.externalBookingId ?? "—" },
                { label: t("bookings.detail.platform"), value: t(`platform.${data.platform}`) },
                {
                  label: t("bookings.detail.source"),
                  value: data.source ? t(`bookings.source.${data.source}`) : "—",
                },
                {
                  label: t("bookings.detail.created"),
                  value: <DateValue value={data.createdAt} withTime />,
                },
                {
                  label: t("bookings.detail.gross"),
                  value: <Money amount={data.line.grossServices} currency={data.currency} />,
                },
                {
                  label: t("bookings.detail.refunds"),
                  value: <Money amount={data.line.refunds} currency={data.currency} />,
                },
                {
                  label: t("bookings.detail.netOfRefunds"),
                  value: <Money amount={data.line.netOfRefunds} currency={data.currency} />,
                },
                {
                  label: t("bookings.detail.commission"),
                  value: <Money amount={data.line.commission} currency={data.currency} />,
                },
                {
                  label: t("bookings.detail.taxCollected"),
                  value: <Money amount={data.line.taxCollected} currency={data.currency} />,
                },
                {
                  label: t("bookings.detail.taxRemitted"),
                  value: <Money amount={data.line.taxRemitted} currency={data.currency} />,
                },
                {
                  label: t("bookings.detail.net"),
                  value: (
                    <span data-testid="booking-net">
                      <Money amount={data.line.net} currency={data.currency} />
                    </span>
                  ),
                },
              ]}
            />
            <Notice title={t("bookings.detail.taxNoteTitle")}>
              {t("bookings.detail.taxNote")}
            </Notice>
          </section>

          <section className="space-y-3 rounded-xl border bg-card p-4">
            <SectionTitle>{t("bookings.detail.statusAction")}</SectionTitle>
            <SelectField
              id="booking-transition"
              label={t("bookings.columns.status")}
              value={target}
              onChange={setTarget}
              options={data.allowedTransitions.map((value) => ({
                value,
                label: t(`bookings.status.${value}`),
              }))}
              disabled={data.allowedTransitions.length === 0}
              hint={data.allowedTransitions.length === 0 ? t("listings.noTransition") : undefined}
            />
            <Button
              variant="outline"
              data-testid="booking-transition-apply"
              disabled={target === "" || transition.isPending}
              onClick={() => transition.mutate()}
            >
              {t("bookings.detail.apply")}
            </Button>
            {transition.error ? <ErrorBox error={errorPayload(transition.error)} /> : null}
          </section>
        </TabsContent>

        <TabsContent value="stay" className="space-y-6 pt-4">
          <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="booking-stay">
            <SectionTitle>{t("bookings.tabs.stay")}</SectionTitle>
            <DefinitionList
              rows={[
                {
                  label: t("bookings.detail.unit"),
                  value: `${data.stay.unitLabel}${data.stay.buildingName ? ` · ${data.stay.buildingName}` : ""}`,
                },
                {
                  label: t("bookings.detail.dates"),
                  value: (
                    <>
                      <DateValue value={data.stay.checkInOn} /> →{" "}
                      <DateValue value={data.stay.checkOutOn} />
                    </>
                  ),
                },
                { label: t("bookings.detail.nights"), value: data.stay.nights },
                {
                  label: t("bookings.detail.guests"),
                  value: `${data.stay.guestName ?? "—"}${data.stay.guestCount ? ` · ${data.stay.guestCount}` : ""}`,
                },
              ]}
            />
          </section>
        </TabsContent>

        <TabsContent value="payouts" className="space-y-6 pt-4">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <SectionTitle>{t("bookings.tabs.payouts")}</SectionTitle>
            {data.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("bookings.detail.noPayout")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("payouts.columns.reference")}</TableHead>
                    <TableHead>{t("payouts.columns.paidOn")}</TableHead>
                    <TableHead>{t("bookings.detail.amount")}</TableHead>
                    <TableHead>{t("payouts.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.payouts.map((payout) => (
                    <TableRow key={payout.payoutId}>
                      <TableCell>
                        <Link
                          className="underline-offset-4 hover:underline"
                          href={`/locations/courte-duree/versements?versement=${payout.payoutId}`}
                        >
                          {payout.externalPayoutId ?? payout.payoutId.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <DateValue value={payout.paidOn} />
                      </TableCell>
                      <TableCell>
                        <Money amount={payout.amount} currency={data.currency} />
                      </TableCell>
                      <TableCell>
                        <PayoutStatusBadge status={payout.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="movements" className="space-y-6 pt-4">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <SectionTitle>{t("bookings.tabs.movements")}</SectionTitle>
            {data.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("bookings.detail.noMovement")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("bookings.detail.movementKind")}</TableHead>
                    <TableHead>{t("bookings.detail.amount")}</TableHead>
                    <TableHead>{t("bookings.detail.occurredOn")}</TableHead>
                    <TableHead>{t("bookings.detail.thirdPartyTax")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((movement) => (
                    <TableRow key={movement.id} data-testid="movement-row">
                      <TableCell>{t(`bookings.movementKind.${movement.kind}`)}</TableCell>
                      <TableCell>
                        <Money amount={movement.amount} currency={movement.currency} />
                      </TableCell>
                      <TableCell>
                        <DateValue value={movement.occurredOn} />
                      </TableCell>
                      <TableCell>{movement.isThirdPartyTax ? t("yes") : t("no")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
