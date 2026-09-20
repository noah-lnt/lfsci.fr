"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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

export function ExpensesTable() {
  const t = useTranslations("finance.expenses");
  const tStatus = useTranslations("finance.status");
  const tPayer = useTranslations("finance.payer");

  const expenses = useQuery({
    queryKey: ["finance", "expenses"],
    queryFn: () => rpc.finance.expenses.list({ limit: 50 }),
  });
  const suppliers = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const supplierName = new Map(
    (suppliers.data?.suppliers ?? []).map((entry) => [entry.id, entry.label]),
  );

  if (expenses.isError) return <ErrorBox error={errorPayload(expenses.error)} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href="/finance/depenses/nouvelle" className={buttonVariants()}>
          {t("new")}
        </Link>
      </div>

      {expenses.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {expenses.data && expenses.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {expenses.data && expenses.data.items.length > 0 ? (
        <ScrollRegion label={t("title")}>
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.issuedOn")}</TableHead>
                <TableHead scope="col">{t("columns.supplier")}</TableHead>
                <TableHead scope="col">{t("columns.reference")}</TableHead>
                <TableHead scope="col">{t("columns.total")}</TableHead>
                <TableHead scope="col">{t("columns.payer")}</TableHead>
                <TableHead scope="col">{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.data.items.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>
                    <DateValue value={expense.issuedOn} />
                  </TableCell>
                  <TableCell>
                    <Link
                      className="underline underline-offset-2"
                      href={`/finance/depenses/${expense.id}`}
                    >
                      {expense.supplierId ? (supplierName.get(expense.supplierId) ?? "—") : "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="num">{expense.supplierReference ?? "—"}</TableCell>
                  <TableCell>
                    <Money amount={expense.totalInclTax} currency={expense.currency} />
                  </TableCell>
                  <TableCell>{tPayer(expense.payer)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tStatus(expense.status)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      ) : null}
    </div>
  );
}
