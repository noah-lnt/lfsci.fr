"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
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
import type { ArrearsRow, ReminderLevel } from "@/lib/contracts/recouvrement";
import { errorPayload, rpc } from "@/lib/rpc";

type Translate = ReturnType<typeof useTranslations>;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight">{children}</p>
    </div>
  );
}

function LeaseCard({
  row,
  t,
  onPropose,
  pending,
}: {
  row: ArrearsRow;
  t: Translate;
  onPropose: (level: ReminderLevel) => void;
  pending: boolean;
}) {
  const nextLevel = row.nextLevel;
  const missingRecipient = row.recipientAddress === null;
  const disabled = pending || nextLevel === null || missingRecipient;
  const hint = missingRecipient
    ? t("detail.noRecipient")
    : nextLevel === null && row.holdReason
      ? t(`hold.${row.holdReason}`)
      : nextLevel
        ? t(`levelAutonomy.${row.nextAutonomy ?? "C"}`)
        : null;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" data-testid="arrears-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">
            {row.leaseReference}
            {row.tenantName ? ` · ${row.tenantName}` : ""}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <Money amount={row.outstanding} currency={row.currency} />
            {" · "}
            {t("table.daysValue", { count: row.daysLate })}
            {" · "}
            <DateValue value={row.oldestDueOn} />
          </p>
        </div>
        <Badge variant={row.suspended ? "destructive" : "secondary"}>
          {t(`qualification.${row.qualification}`)}
        </Badge>
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">{t("detail.terms")}</h4>
        <ScrollRegion label={t("detail.terms")} className="mt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.period")}</TableHead>
                <TableHead>{t("detail.dueOn")}</TableHead>
                <TableHead>{t("detail.total")}</TableHead>
                <TableHead>{t("detail.allocated")}</TableHead>
                <TableHead>{t("detail.remaining")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {row.terms.map((term) => (
                <TableRow key={term.rentTermId} data-testid="arrears-term-row">
                  <TableCell>
                    <DateValue value={term.periodStart} /> — <DateValue value={term.periodEnd} />
                  </TableCell>
                  <TableCell>
                    <DateValue value={term.dueOn} />
                  </TableCell>
                  <TableCell>
                    <Money amount={term.total} currency={row.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={term.allocated} currency={row.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={term.outstanding} currency={row.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      </div>

      <div>
        <h4 className="text-xs font-medium text-muted-foreground">{t("detail.history")}</h4>
        {row.reminders.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground" data-testid="reminder-history-empty">
            {t("detail.historyEmpty")}
          </p>
        ) : (
          <ScrollRegion label={t("detail.history")} className="mt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("detail.template")}</TableHead>
                  <TableHead>{t("detail.recipient")}</TableHead>
                  <TableHead>{t("detail.status")}</TableHead>
                  <TableHead>{t("detail.sentAt")}</TableHead>
                  <TableHead>{t("detail.error")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {row.reminders.map((reminder) => (
                  <TableRow key={reminder.messageId} data-testid="reminder-row">
                    <TableCell>
                      {reminder.level ? t(`level.${reminder.level}`) : reminder.templateCode}
                      {reminder.templateVersion ? (
                        <span className="num block text-xs text-muted-foreground">
                          {reminder.templateVersion}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="break-all">{reminder.recipient}</TableCell>
                    <TableCell>{reminder.status}</TableCell>
                    <TableCell>
                      <DateValue value={reminder.sentAt} withTime />
                    </TableCell>
                    <TableCell>{reminder.errorCode ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={disabled}
          data-testid="propose-reminder"
          onClick={() => {
            if (nextLevel) onPropose(nextLevel);
          }}
        >
          <Send aria-hidden="true" />
          {nextLevel
            ? t("action.proposeLevel", { level: t(`level.${nextLevel}`) })
            : t("action.propose")}
        </Button>
        {hint ? (
          <p className="text-sm text-muted-foreground" data-testid="propose-hint">
            {hint}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function RecouvrementView() {
  const t = useTranslations("recouvrement");
  const client = useQueryClient();

  const screen = useQuery({
    queryKey: ["recouvrement"],
    queryFn: () => rpc.recouvrement.list({}),
  });

  const propose = useMutation({
    mutationFn: (input: { leaseId: string; level: ReminderLevel }) =>
      rpc.recouvrement.propose(input),
    onSuccess: async () => {
      toast.success(t("action.prepared"));
      await client.invalidateQueries({ queryKey: ["recouvrement"] });
    },
  });

  if (screen.isError) return <ErrorBox error={errorPayload(screen.error)} />;
  if (!screen.data) return <Skeleton className="h-64 w-full" />;

  const { asOf, policy, totals, rows } = screen.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("totals.leases")}>{totals.leases}</Stat>
        <Stat label={t("totals.outstanding")}>
          <Money amount={totals.outstanding} currency={totals.currency} />
        </Stat>
        <Stat label={t("totals.suspended")}>{totals.suspended}</Stat>
      </div>

      <section className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{t("policy.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("asOf")} <DateValue value={asOf} />
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[minmax(0,20rem)_1fr]">
          <dt className="text-muted-foreground">{t("policy.graceDays")}</dt>
          <dd>{t("policy.days", { count: policy.graceDays })}</dd>
          <dt className="text-muted-foreground">{t("policy.firstReminderDays")}</dt>
          <dd>{t("policy.days", { count: policy.firstReminderDays })}</dd>
          <dt className="text-muted-foreground">{t("policy.secondReminderDays")}</dt>
          <dd>{t("policy.days", { count: policy.secondReminderDays })}</dd>
          <dt className="text-muted-foreground">{t("policy.formalNoticeDays")}</dt>
          <dd>{t("policy.days", { count: policy.formalNoticeDays })}</dd>
          <dt className="text-muted-foreground">{t("policy.minimumSpacingDays")}</dt>
          <dd>{t("policy.days", { count: policy.minimumSpacingDays })}</dd>
          <dt className="text-muted-foreground">{t("policy.minimumOutstanding")}</dt>
          <dd>
            <Money amount={policy.minimumOutstanding} currency={totals.currency} />
          </dd>
        </dl>
        <p className="text-sm text-muted-foreground">{t("policy.pending")}</p>
      </section>

      {propose.error ? <ErrorBox error={errorPayload(propose.error)} /> : null}

      {propose.data ? (
        <section className="space-y-2 rounded-xl border bg-card p-4" data-testid="reminder-preview">
          <h2 className="text-sm font-semibold tracking-tight">{t("action.preview")}</h2>
          <p className="text-sm">
            <span className="text-muted-foreground">{t("action.subject")} : </span>
            {propose.data.subject}
          </p>
          <textarea
            readOnly
            aria-label={t("action.preview")}
            value={propose.data.body}
            className="h-64 w-full resize-y rounded-md bg-muted p-3 font-mono text-xs"
          />
          <p className="text-sm text-muted-foreground">{t("action.preparedHint")}</p>
          <Link href="/validations" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("action.openApprovals")}
          </Link>
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : (
        <>
          <ScrollRegion label={t("title")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.lease")}</TableHead>
                  <TableHead>{t("table.tenant")}</TableHead>
                  <TableHead>{t("table.outstanding")}</TableHead>
                  <TableHead>{t("table.oldestDueOn")}</TableHead>
                  <TableHead>{t("table.daysLate")}</TableHead>
                  <TableHead>{t("table.qualification")}</TableHead>
                  <TableHead>{t("table.nextAction")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.leaseId} data-testid="arrears-row">
                    <TableCell>{row.leaseReference}</TableCell>
                    <TableCell>{row.tenantName ?? "—"}</TableCell>
                    <TableCell>
                      <Money amount={row.outstanding} currency={row.currency} />
                    </TableCell>
                    <TableCell>
                      <DateValue value={row.oldestDueOn} />
                    </TableCell>
                    <TableCell className="num">
                      {t("table.daysValue", { count: row.daysLate })}
                    </TableCell>
                    <TableCell>{t(`qualification.${row.qualification}`)}</TableCell>
                    <TableCell>
                      {row.nextLevel
                        ? t(`level.${row.nextLevel}`)
                        : row.holdReason
                          ? t(`hold.${row.holdReason}`)
                          : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>

          <div className="space-y-4">
            {rows.map((row) => (
              <LeaseCard
                key={row.leaseId}
                row={row}
                t={t}
                pending={propose.isPending}
                onPropose={(level) => propose.mutate({ leaseId: row.leaseId, level })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
