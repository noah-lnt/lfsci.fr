"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { errorPayload, rpc } from "@/lib/rpc";
import { ScrollRegion } from "./scroll-region";

export function ExpenseDetail({ id }: { id: string }) {
  const t = useTranslations("finance.expenses.detail");
  const tForm = useTranslations("finance.expenses.form");
  const tStatus = useTranslations("finance.status");
  const tPayer = useTranslations("finance.payer");
  const queryClient = useQueryClient();
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [outcome, setOutcome] = useState<{ level: string; commandId: string } | null>(null);

  const expense = useQuery({
    queryKey: ["finance", "expense", id],
    queryFn: () => rpc.finance.expenses.get({ id }),
  });

  const validate = useMutation({
    mutationFn: async () => {
      const current = expense.data;
      if (!current) throw new Error("expense not loaded");
      return rpc.finance.expenses.validate({ id, expectedVersion: current.version });
    },
    onSuccess: async (result) => {
      setError(null);
      setOutcome({ level: result.decisionLevel, commandId: result.commandId });
      await queryClient.invalidateQueries({ queryKey: ["finance", "expense", id] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  if (expense.isError) return <ErrorBox error={errorPayload(expense.error)} />;
  if (!expense.data) return <Skeleton className="h-64 w-full" />;

  const data = expense.data;
  const targetLabel = (target: string) =>
    target === "unit"
      ? tForm("targetUnit")
      : target === "building_common"
        ? tForm("targetBuilding")
        : tForm("targetEntity");

  return (
    <div className="space-y-6">
      {error ? <ErrorBox error={error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            <Money amount={data.totalInclTax} currency={data.currency} />
            <Badge variant="secondary">{tStatus(data.status)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{tForm("issuedOn")}</dt>
            <dd>
              <DateValue value={data.issuedOn} />
            </dd>
            <dt className="text-muted-foreground">{tForm("reference")}</dt>
            <dd className="num">{data.supplierReference ?? "—"}</dd>
            <dt className="text-muted-foreground">{tForm("payer")}</dt>
            <dd>{tPayer(data.payer)}</dd>
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => validate.mutate()}
              disabled={validate.isPending || data.status === "validated"}
            >
              {validate.isPending ? t("validating") : t("validate")}
            </Button>
            {outcome ? (
              <p role="status" className="text-sm" data-testid="validation-outcome">
                {t("validated", { level: outcome.level })}{" "}
                <span className="num text-muted-foreground">
                  {t("commandId")} : {outcome.commandId}
                </span>
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("lines")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.lines.length === 0 ? <p className="text-sm">{t("noLines")}</p> : null}
          {data.lines.map((line) => (
            <section key={line.id} className="space-y-2">
              <h3 className="text-sm font-medium">
                {line.lineNumber}. {line.description} —{" "}
                <Money amount={line.amountInclTax} currency={line.currency} />
              </h3>
              <ScrollRegion label={t("allocations")}>
                <Table>
                  <caption className="sr-only">{t("allocations")}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{tForm("target")}</TableHead>
                      <TableHead scope="col">{tForm("lineAmount")}</TableHead>
                      <TableHead scope="col">{tForm("lineRecoverable")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {line.allocations.map((allocation) => (
                      <TableRow key={allocation.id}>
                        <TableCell>{targetLabel(allocation.target)}</TableCell>
                        <TableCell>
                          <Money amount={allocation.amount} currency={allocation.currency} />
                        </TableCell>
                        <TableCell>
                          <Money
                            amount={allocation.recoverableAmount}
                            currency={allocation.currency}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollRegion>
              <p className="text-xs text-muted-foreground">
                {t("unallocated")} :{" "}
                <Money amount={line.unallocatedAmount} currency={line.currency} />
              </p>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
