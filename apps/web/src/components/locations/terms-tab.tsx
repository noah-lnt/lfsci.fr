"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
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
import { errorPayload, rpc } from "@/lib/rpc";
import { SettlementBadge } from "./ui";

function monthsAhead(count: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + count, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function TermsTab({ leaseId }: { leaseId: string }) {
  const t = useTranslations("locations");
  const client = useQueryClient();

  const terms = useQuery({
    queryKey: ["locations", "terms", leaseId],
    queryFn: () => rpc.locations.rentTerms.list({ leaseId, limit: 100 }),
  });

  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ["locations"] });
  };

  const generate = useMutation({
    mutationFn: () => rpc.locations.rentTerms.generate({ leaseId, ...monthsAhead(3) }),
    onSuccess: async (result) => {
      toast.success(t("terms.generated", { created: result.created, skipped: result.skipped }));
      await invalidate();
    },
  });

  const issue = useMutation({
    mutationFn: (input: { rentTermId: string; kind: "quittance" | "recu" }) =>
      rpc.locations.receipts.issue(input),
    onSuccess: async () => {
      toast.success(t("terms.issueDone"));
      await invalidate();
    },
  });

  const items = terms.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("terms.generateHint")}</p>
        <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
          <CalendarPlus aria-hidden="true" />
          {t("terms.generate")}
        </Button>
      </div>

      {generate.error ? <ErrorBox error={errorPayload(generate.error)} /> : null}
      {issue.error ? <ErrorBox error={errorPayload(issue.error)} /> : null}

      {items.length === 0 ? (
        <EmptyState title={t("terms.title")}>{t("empty.terms")}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.period")}</TableHead>
                <TableHead>{t("columns.dueOn")}</TableHead>
                <TableHead>{t("columns.amount")}</TableHead>
                <TableHead>{t("columns.paid")}</TableHead>
                <TableHead>{t("columns.outstanding")}</TableHead>
                <TableHead>{t("columns.settlement")}</TableHead>
                <TableHead>{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((term) => (
                <TableRow key={term.id} data-testid="term-row">
                  <TableCell>
                    <DateValue value={term.periodStart} /> → <DateValue value={term.periodEnd} />
                  </TableCell>
                  <TableCell>
                    <DateValue value={term.dueOn} />
                  </TableCell>
                  <TableCell>
                    <Money amount={term.totalAmount} currency={term.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={term.paidAmount} currency={term.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={term.outstanding} currency={term.currency} />
                  </TableCell>
                  <TableCell>
                    <SettlementBadge settlement={term.settlement} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`issue-${term.receipt}`}
                      disabled={issue.isPending || term.settlement === "unpaid"}
                      onClick={() => issue.mutate({ rentTermId: term.id, kind: term.receipt })}
                    >
                      <ReceiptText aria-hidden="true" />
                      {term.receipt === "quittance" ? t("terms.quittance") : t("terms.recu")}
                    </Button>
                    {term.receiptIssued ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("terms.issued")}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
