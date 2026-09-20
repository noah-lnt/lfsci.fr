"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { SectionTitle, SelectField } from "@/components/locations/ui";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PayoutRow } from "@/lib/contracts/courte-duree";
import { errorPayload, rpc } from "@/lib/rpc";
import { ReconciliationPanel } from "./import-wizard";
import { ModelNotice, PayoutStatusBadge } from "./ui";

const STATUSES = ["imported", "matched", "variance", "confirmed", "rejected"] as const;

export function PayoutsView() {
  const t = useTranslations("courteDuree");
  const client = useQueryClient();
  const params = useSearchParams();
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(params.get("versement"));

  const payouts = useQuery({
    queryKey: ["courte-duree", "payouts", status],
    queryFn: () =>
      rpc.courteDuree.payouts.list({
        limit: 100,
        ...(status ? { status: status as PayoutRow["status"] } : {}),
      }),
  });

  const detail = useQuery({
    queryKey: ["courte-duree", "payout", selected],
    queryFn: () => rpc.courteDuree.payouts.get({ id: selected ?? "" }),
    enabled: selected !== null,
  });

  const decide = useMutation({
    mutationFn: (decision: "confirm" | "reject") =>
      rpc.courteDuree.payouts.decide({
        id: selected ?? "",
        expectedVersion: detail.data?.version ?? 1,
        decision,
      }),
    onSuccess: async (_data, decision) => {
      toast.success(decision === "confirm" ? t("payouts.confirmed") : t("payouts.rejected"));
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
    },
  });

  const data = detail.data;
  const blockedByVariance = data ? data.varianceAmount !== "0.00" : true;

  return (
    <div className="space-y-6">
      <ModelNotice />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <SelectField
          id="payout-filter-status"
          label={t("payouts.filters.status")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "", label: t("payouts.filters.all") },
            ...STATUSES.map((value) => ({ value, label: t(`payouts.status.${value}`) })),
          ]}
        />
      </div>

      {payouts.error ? <ErrorBox error={errorPayload(payouts.error)} /> : null}

      {payouts.data && payouts.data.items.length === 0 ? (
        <EmptyState title={t("payouts.title")}>{t("payouts.empty")}</EmptyState>
      ) : null}

      {payouts.data && payouts.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("payouts.columns.reference")}</TableHead>
                <TableHead>{t("payouts.columns.paidOn")}</TableHead>
                <TableHead>{t("payouts.columns.entity")}</TableHead>
                <TableHead>{t("payouts.columns.net")}</TableHead>
                <TableHead>{t("payouts.columns.variance")}</TableHead>
                <TableHead>{t("payouts.columns.lines")}</TableHead>
                <TableHead>{t("payouts.columns.status")}</TableHead>
                <TableHead>{t("payouts.detail")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.data.items.map((payout) => (
                <TableRow key={payout.id} data-testid="payout-row">
                  <TableCell className="font-medium">
                    {payout.externalPayoutId ?? payout.id.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    <DateValue value={payout.paidOn} />
                  </TableCell>
                  <TableCell>{payout.legalEntityName}</TableCell>
                  <TableCell>
                    <Money amount={payout.netAmount} currency={payout.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={payout.varianceAmount} currency={payout.currency} />
                  </TableCell>
                  <TableCell className="num">{payout.detailCount}</TableCell>
                  <TableCell>
                    <PayoutStatusBadge status={payout.status} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="payout-open"
                      onClick={() => setSelected(payout.id)}
                    >
                      {t("payouts.detail")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {detail.error ? <ErrorBox error={errorPayload(detail.error)} /> : null}

      {data ? (
        <section className="space-y-4 rounded-xl border bg-card p-4" data-testid="payout-detail">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>
              {t("payouts.detail")} · {data.externalPayoutId ?? data.id.slice(0, 8)}
            </SectionTitle>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              {t("payouts.close")}
            </Button>
          </div>

          <ReconciliationPanel reconciliation={data.reconciliation} />

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("payouts.columns.reference")}</TableHead>
                  <TableHead>{t("bookings.detail.amount")}</TableHead>
                  <TableHead>{t("bookings.detail.movementKind")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.details.map((line) => (
                  <TableRow key={line.id} data-testid="payout-detail-row">
                    <TableCell>{line.bookingReference ?? line.label ?? t("empty")}</TableCell>
                    <TableCell>
                      <Money amount={line.amount} currency={line.currency} />
                    </TableCell>
                    <TableCell>
                      {line.movementKind
                        ? t(`bookings.movementKind.${line.movementKind}`)
                        : t("empty")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="payout-confirm"
              disabled={blockedByVariance || decide.isPending}
              onClick={() => decide.mutate("confirm")}
            >
              {t("payouts.confirm")}
            </Button>
            <Button
              variant="outline"
              data-testid="payout-reject"
              disabled={decide.isPending}
              onClick={() => decide.mutate("reject")}
            >
              {t("payouts.reject")}
            </Button>
            {blockedByVariance ? (
              <p className="text-sm text-muted-foreground" data-testid="payout-variance-note">
                {t("payouts.varianceBlocked")}
              </p>
            ) : null}
          </div>
          {decide.error ? <ErrorBox error={errorPayload(decide.error)} /> : null}
        </section>
      ) : null}
    </div>
  );
}
