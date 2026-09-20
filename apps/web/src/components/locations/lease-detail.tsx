"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { PageNav } from "@/components/layout/page-nav";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import { Money } from "@/components/ui/money";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LeaseDetail } from "@/lib/contracts/locations";
import { errorPayload, rpc } from "@/lib/rpc";
import { DepositTab } from "./deposit-tab";
import { PaymentsTab } from "./payments-tab";
import { RevisionTab } from "./revision-tab";
import { TermsTab } from "./terms-tab";
import { DefinitionList, LeaseStatusBadge, SectionTitle, SelectField } from "./ui";

type TimelineEntry = { date: string; label: string };

function timelineOf(
  lease: LeaseDetail,
  t: (key: string, values?: Record<string, string>) => string,
  extra: TimelineEntry[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { date: lease.createdAt.slice(0, 10), label: t("timeline.leaseCreated") },
    ...(lease.startsOn ? [{ date: lease.startsOn, label: t("timeline.leaseStart") }] : []),
    ...(lease.signedOn ? [{ date: lease.signedOn, label: t("timeline.leaseSigned") }] : []),
    ...(lease.endsOn ? [{ date: lease.endsOn, label: t("timeline.leaseEnd") }] : []),
    ...extra,
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export function LeaseDetailView({ leaseId }: { leaseId: string }) {
  const t = useTranslations("locations");
  const client = useQueryClient();
  const [target, setTarget] = useState("");

  const lease = useQuery({
    queryKey: ["locations", "lease", leaseId],
    queryFn: () => rpc.locations.leases.get({ id: leaseId }),
  });
  const terms = useQuery({
    queryKey: ["locations", "terms", leaseId],
    queryFn: () => rpc.locations.rentTerms.list({ leaseId, limit: 100 }),
  });
  const payments = useQuery({
    queryKey: ["locations", "payments", leaseId],
    queryFn: () => rpc.locations.payments.list({ leaseId, limit: 100 }),
  });
  const receipts = useQuery({
    queryKey: ["locations", "receipts", leaseId],
    queryFn: () => rpc.locations.receipts.list({ leaseId, limit: 100 }),
  });

  const transition = useMutation({
    mutationFn: (to: string) =>
      rpc.locations.leases.transition({
        id: leaseId,
        expectedVersion: lease.data?.version ?? 1,
        to: to as LeaseDetail["status"],
      }),
    onSuccess: async () => {
      toast.success(t("summary.transitioned"));
      setTarget("");
      await client.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  if (lease.error) return <ErrorBox error={errorPayload(lease.error)} />;
  if (!lease.data) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  const data = lease.data;
  const transitions = data.allowedTransitions;
  const extra: TimelineEntry[] = [
    ...(terms.data?.items ?? []).map((term) => ({
      date: term.dueOn,
      label: t("timeline.term", { period: term.periodStart }),
    })),
    ...(payments.data?.items ?? []).map((payment) => ({
      date: payment.receivedOn,
      label: `${t("timeline.payment")} — ${payment.amount} ${payment.currency}`,
    })),
    ...(receipts.data?.items ?? []).map((receipt) => ({
      date: receipt.issuedOn,
      label: `${t("timeline.receipt")} — ${receipt.kind}`,
    })),
  ];

  return (
    <>
      <PageNav
        title={data.reference}
        description={`${t(`leaseKind.${data.kind}`)}${data.unitLabel ? ` · ${data.unitLabel}` : ""}`}
        icon={<KeyRound className="size-5" aria-hidden="true" />}
      >
        <LeaseStatusBadge status={data.status} />
        <LinkButton href={`/locations/baux/${data.id}/etats-des-lieux`} variant="outline" size="sm">
          {t("tabs.inspections")}
        </LinkButton>
        <LinkButton href={`/locations/baux/${data.id}/revisions`} variant="outline" size="sm">
          {t("tabs.revisionDetail")}
        </LinkButton>
        <LinkButton href="/locations" variant="outline" size="sm">
          <ArrowLeft aria-hidden="true" />
          {t("backToLeases")}
        </LinkButton>
      </PageNav>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">{t("tabs.summary")}</TabsTrigger>
          <TabsTrigger value="terms">{t("tabs.terms")}</TabsTrigger>
          <TabsTrigger value="payments">{t("tabs.payments")}</TabsTrigger>
          <TabsTrigger value="deposit">{t("tabs.deposit")}</TabsTrigger>
          <TabsTrigger value="revision">{t("tabs.revision")}</TabsTrigger>
          <TabsTrigger value="timeline">{t("tabs.timeline")}</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-6 pt-4">
          <section className="space-y-4 rounded-xl border bg-card p-4">
            <SectionTitle>{t("summary.contract")}</SectionTitle>
            <DefinitionList
              rows={[
                { label: t("form.startsOn"), value: <DateValue value={data.startsOn} /> },
                { label: t("form.endsOn"), value: <DateValue value={data.endsOn} /> },
                {
                  label: t("form.rentExclCharges"),
                  value: <Money amount={data.rentExclCharges} currency={data.currency} />,
                },
                {
                  label: t("form.chargeAmount"),
                  value: <Money amount={data.chargeAmount} currency={data.currency} />,
                },
                { label: t("form.chargeRegime"), value: t(`chargeRegime.${data.chargeRegime}`) },
                { label: t("form.paymentDay"), value: data.paymentDay ?? "—" },
                {
                  label: t("form.depositAmount"),
                  value: <Money amount={data.depositAmount} currency={data.currency} />,
                },
                {
                  label: t("form.revisionIndexLabel"),
                  value: data.revisionIndex ? t(`revisionIndex.${data.revisionIndex}`) : "—",
                },
                {
                  label: t("form.referenceQuarter"),
                  value: data.revisionReferenceQuarter?.replace("Q", "T") ?? "—",
                },
                { label: t("columns.arrears"), value: <Money amount={data.arrears} /> },
              ]}
            />
          </section>

          <section className="space-y-3 rounded-xl border bg-card p-4">
            <SectionTitle>{t("summary.parties")}</SectionTitle>
            <ul className="space-y-1 text-sm">
              {data.parties.map((party) => (
                <li key={party.id}>
                  <Link
                    className="underline-offset-4 hover:underline"
                    href={`/locations/locataires/${party.personId}`}
                  >
                    {party.personName}
                  </Link>{" "}
                  <span className="text-muted-foreground">· {t(`partyRole.${party.role}`)}</span>
                </li>
              ))}
            </ul>
            <SectionTitle>{t("summary.units")}</SectionTitle>
            <ul className="space-y-1 text-sm">
              {data.units.map((unit) => (
                <li key={unit.id}>
                  {unit.unitLabel} · {unit.buildingName}
                </li>
              ))}
            </ul>
          </section>

          {data.missingPieces.length > 0 ? (
            <section
              className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
              data-testid="missing-pieces"
            >
              <SectionTitle>{t("summary.missingTitle")}</SectionTitle>
              <p className="text-sm text-muted-foreground">{t("summary.missingHint")}</p>
              <ul className="list-inside list-disc text-sm">
                {data.missingPieces.map((piece) => (
                  <li key={piece}>{t(`summary.missing.${piece}`)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-4 rounded-xl border bg-card p-4">
            <SectionTitle>{t("summary.transitionTo")}</SectionTitle>
            {transitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("summary.noTransition")}</p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56">
                <SelectField
                  id="lease-transition"
                  label={t("columns.status")}
                  value={target}
                  onChange={setTarget}
                  disabled={transitions.length === 0}
                  options={transitions.map((value) => ({
                    value,
                    label: t(`status.${value}`),
                  }))}
                />
              </div>
              <Button
                disabled={!target || transition.isPending}
                data-testid="lease-transition-apply"
                onClick={() => transition.mutate(target)}
              >
                {t("summary.transition")}
              </Button>
            </div>
            {transition.error ? <ErrorBox error={errorPayload(transition.error)} /> : null}
          </section>
        </TabsContent>

        <TabsContent value="terms" className="pt-4">
          <TermsTab leaseId={leaseId} />
        </TabsContent>
        <TabsContent value="payments" className="pt-4">
          <PaymentsTab leaseId={leaseId} />
        </TabsContent>
        <TabsContent value="deposit" className="pt-4">
          <DepositTab leaseId={leaseId} />
        </TabsContent>
        <TabsContent value="revision" className="pt-4">
          <RevisionTab leaseId={leaseId} leaseVersion={data.version} />
        </TabsContent>
        <TabsContent value="timeline" className="pt-4">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <SectionTitle>{t("timeline.title")}</SectionTitle>
            <ul className="space-y-2 text-sm">
              {timelineOf(data, t, extra).map((entry) => (
                <li key={`${entry.date}-${entry.label}`} className="flex gap-3">
                  <DateValue value={entry.date} className="w-24 shrink-0 text-muted-foreground" />
                  <span>{entry.label}</span>
                </li>
              ))}
            </ul>
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
