"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calculator, FileText, Lock, Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RegularizationRunRead } from "@/lib/contracts/charges";
import { errorPayload, rpc } from "@/lib/rpc";
import { ConfirmButton } from "./confirm-button";

function Kpi({ label, amount, currency }: { label: string; amount: string; currency: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">
        <Money amount={amount} currency={currency} />
      </p>
    </div>
  );
}

export function RunDetail({ id }: { id: string }) {
  const t = useTranslations("charges.runs");
  const client = useQueryClient();

  const run = useQuery({
    queryKey: ["charges", "run", id],
    queryFn: () => rpc.charges.runs.get({ id }),
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ["charges"] });
  const version = run.data?.version ?? 1;

  const compute = useMutation({
    mutationFn: () => rpc.charges.runs.compute({ id, expectedVersion: version }),
    onSuccess: async () => {
      toast.success(t("computed"));
      await invalidate();
    },
  });
  const freeze = useMutation({
    mutationFn: () => rpc.charges.runs.freeze({ id, expectedVersion: version }),
    onSuccess: async () => {
      toast.success(t("frozen"));
      await invalidate();
    },
  });
  const close = useMutation({
    mutationFn: () => rpc.charges.runs.close({ id, expectedVersion: version }),
    onSuccess: async (result) => {
      toast.success(t("closed", { count: String(result.commands.length) }));
      await invalidate();
    },
  });
  const statement = useMutation({
    mutationFn: (leaseId: string) => rpc.charges.runs.statement({ id, leaseId }),
    onSuccess: async () => {
      toast.success(t("statementIssued"));
      await invalidate();
    },
  });
  const cancel = useMutation({
    mutationFn: () => rpc.charges.runs.cancel({ id, expectedVersion: version }),
    onSuccess: async () => {
      toast.success(t("cancelled"));
      await invalidate();
    },
  });

  if (run.isError) return <ErrorBox error={errorPayload(run.error)} />;
  if (!run.data) return <Skeleton className="h-64 w-full" />;

  const data: RegularizationRunRead = run.data;
  const open = data.status === "draft" || data.status === "computed";
  const error =
    compute.error ?? freeze.error ?? close.error ?? statement.error ?? cancel.error ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {data.legalEntityName}
            {data.buildingName ? ` · ${data.buildingName}` : ` · ${t("buildingAll")}`}
          </h2>
          <p className="num text-sm text-muted-foreground">
            <DateValue value={data.periodStart} /> — <DateValue value={data.periodEnd} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge data-testid="run-status">{t(`statusValue.${data.status}`)}</Badge>
          <Link href="/finance/charges" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft aria-hidden="true" />
            {t("back")}
          </Link>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="run-source">
        {data.source === "frozen" ? t("sourceFrozen") : t("sourceLive")}
      </p>

      {data.blockedReason ? (
        <div
          className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
          data-testid="run-blocked"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{t("blockedTitle")}</p>
            <p className="text-muted-foreground">{t(`blocked.${data.blockedReason}`)}</p>
            {data.missing.length > 0 ? (
              <p className="text-muted-foreground">
                {t("missing", { fields: data.missing.join(", ") })}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label={t("totalRecoverable")}
          amount={data.totalRecoverable}
          currency={data.currency}
        />
        <Kpi
          label={t("totalProvisionsCalled")}
          amount={data.totalProvisionsCalled}
          currency={data.currency}
        />
        <Kpi label={t("netBalance")} amount={data.netBalance} currency={data.currency} />
        <Kpi
          label={t("unpaidProvisions")}
          amount={data.unpaidProvisions}
          currency={data.currency}
        />
        <Kpi label={t("totalOwnerShare")} amount={data.totalOwnerShare} currency={data.currency} />
      </div>

      {/* Every control is rendered, disabled when the state forbids it. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!open || compute.isPending}
          onClick={() => compute.mutate()}
          data-testid="run-compute"
        >
          <Calculator aria-hidden="true" />
          {t("compute")}
        </Button>
        <Button
          disabled={!open || Boolean(data.blockedReason) || freeze.isPending}
          onClick={() => freeze.mutate()}
          data-testid="run-freeze"
        >
          <Lock aria-hidden="true" />
          {t("freeze")}
        </Button>
        <Button
          variant="outline"
          disabled={data.status !== "frozen" || close.isPending}
          onClick={() => close.mutate()}
          data-testid="run-close"
        >
          <Send aria-hidden="true" />
          {t("close")}
        </Button>
        <ConfirmButton
          label={t("cancelRun")}
          title={t("cancelConfirmTitle")}
          body={t("cancelConfirmBody")}
          cancelLabel={t("cancel")}
          confirmLabel={t("confirm")}
          disabled={data.status === "cancelled" || data.status === "posted" || cancel.isPending}
          testId="run-cancel"
          onConfirm={() => cancel.mutate()}
        />
      </div>

      {error ? <ErrorBox error={errorPayload(error)} /> : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{t("postings")}</h3>
        <ScrollRegion label={t("postings")}>
          <Table>
            <caption className="sr-only">{t("postings")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("posting.label")}</TableHead>
                <TableHead scope="col">{t("posting.nature")}</TableHead>
                <TableHead scope="col">{t("posting.amount")}</TableHead>
                <TableHead scope="col">{t("posting.key")}</TableHead>
                <TableHead scope="col">{t("posting.lot")}</TableHead>
                <TableHead scope="col">{t("posting.lotAmount")}</TableHead>
                <TableHead scope="col">{t("posting.vacancy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.postings.flatMap((posting) =>
                posting.lots.map((lot) => (
                  <TableRow key={`${posting.chargeId}-${lot.unitId}`}>
                    <TableCell>{posting.label}</TableCell>
                    <TableCell>{posting.chargeNature ?? "—"}</TableCell>
                    <TableCell>
                      <Money amount={posting.recoverableAmount} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      {posting.keyLabel
                        ? `${posting.keyLabel} · ${t("keyVersion", { sequence: String(posting.keyVersionSequence ?? "") })}`
                        : t("posting.keyNone")}
                    </TableCell>
                    <TableCell>{lot.unitLabel}</TableCell>
                    <TableCell>
                      <Money amount={lot.amount} currency={data.currency} />
                    </TableCell>
                    <TableCell className="num">
                      {t("posting.days", { days: String(lot.vacancyDays) })} ·{" "}
                      <Money amount={lot.ownerAmount} currency={data.currency} />
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </ScrollRegion>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight">{t("lines")}</h3>
        <p className="text-sm text-muted-foreground">{t("unpaidNotice")}</p>
        <ScrollRegion label={t("lines")}>
          <Table>
            <caption className="sr-only">{t("lines")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("line.tenant")}</TableHead>
                <TableHead scope="col">{t("line.unit")}</TableHead>
                <TableHead scope="col">{t("line.occupancy")}</TableHead>
                <TableHead scope="col">{t("line.recoverable")}</TableHead>
                <TableHead scope="col">{t("line.called")}</TableHead>
                <TableHead scope="col">{t("line.paid")}</TableHead>
                <TableHead scope="col">{t("line.unpaid")}</TableHead>
                <TableHead scope="col">{t("line.balance")}</TableHead>
                <TableHead scope="col">{t("statement")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((line) => (
                <TableRow key={line.leaseId}>
                  <TableCell>
                    {line.tenantName}
                    <span className="block text-xs text-muted-foreground">
                      {line.leaseReference}
                    </span>
                  </TableCell>
                  <TableCell>{line.unitLabel}</TableCell>
                  <TableCell className="num">
                    {line.occupancyDays} / {line.periodDays}
                  </TableCell>
                  <TableCell>
                    <Money amount={line.recoverableAmount} currency={line.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.provisionsCalled} currency={line.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.provisionsPaid} currency={line.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.provisionsUnpaid} currency={line.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.balanceAmount} currency={line.currency} />
                    <span className="block text-xs text-muted-foreground">
                      {t(`direction.${line.direction}`)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={data.source !== "frozen" || statement.isPending}
                      onClick={() => statement.mutate(line.leaseId)}
                      data-testid={`run-statement-${line.leaseId}`}
                    >
                      <FileText aria-hidden="true" />
                      {t("statement")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      </section>

      {data.excluded.length > 0 ? (
        <section className="space-y-2 rounded-xl border bg-card p-4" data-testid="run-excluded">
          <h3 className="text-sm font-semibold tracking-tight">{t("excluded")}</h3>
          <p className="text-sm text-muted-foreground">{t("excludedHint")}</p>
          <ul className="space-y-1 text-sm">
            {data.excluded.map((entry) => (
              <li key={entry.leaseId}>
                {entry.leaseReference} · {t(`excludedReason.${entry.reason}`)} ·{" "}
                <Money amount={entry.amount} currency={data.currency} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
