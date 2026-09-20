"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
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

export function AssetsTable() {
  const t = useTranslations("finance.assets");
  const tStatus = useTranslations("finance.status");
  const assets = useQuery({
    queryKey: ["finance", "assets"],
    queryFn: () => rpc.finance.assets.list({ limit: 50 }),
  });

  if (assets.isError) return <ErrorBox error={errorPayload(assets.error)} />;
  if (assets.isPending) return <Skeleton className="h-40 w-full" />;
  if (!assets.data || assets.data.items.length === 0) {
    return <EmptyState title={t("title")}>{t("empty")}</EmptyState>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("landNote")}</p>
      <ScrollRegion label={t("title")}>
        <Table>
          <caption className="sr-only">{t("title")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("columns.label")}</TableHead>
              <TableHead scope="col">{t("columns.gross")}</TableHead>
              <TableHead scope="col">{t("columns.land")}</TableHead>
              <TableHead scope="col">{t("columns.depreciable")}</TableHead>
              <TableHead scope="col">{t("columns.accumulated")}</TableHead>
              <TableHead scope="col">{t("columns.nbv")}</TableHead>
              <TableHead scope="col">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assets.data.items.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell>{asset.label}</TableCell>
                <TableCell>
                  <Money amount={asset.grossValue} currency={asset.currency} />
                </TableCell>
                <TableCell>
                  <Money amount={asset.landValue} currency={asset.currency} />
                </TableCell>
                <TableCell>
                  <Money amount={asset.depreciableGross} currency={asset.currency} />
                </TableCell>
                <TableCell>
                  <Money amount={asset.accumulatedAt} currency={asset.currency} />
                </TableCell>
                <TableCell data-testid="asset-nbv">
                  <Money amount={asset.netBookValueAt} currency={asset.currency} />
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{tStatus(asset.status)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollRegion>
      <p className="text-xs text-muted-foreground">
        {t("computedOn")} <DateValue value={assets.data.items[0]?.computedOn ?? null} />
      </p>
    </div>
  );
}

export function BanksTable() {
  const t = useTranslations("finance.banks");
  const balances = useQuery({
    queryKey: ["finance", "bank", "balances"],
    queryFn: () => rpc.finance.bank.balances({}),
  });
  const accounts = useQuery({
    queryKey: ["finance", "bank", "accounts"],
    queryFn: () => rpc.finance.bank.accounts({}),
  });

  if (balances.isError) return <ErrorBox error={errorPayload(balances.error)} />;
  if (balances.isPending) return <Skeleton className="h-40 w-full" />;
  if (!balances.data || balances.data.balances.length === 0) {
    return <EmptyState title={t("title")}>{t("empty")}</EmptyState>;
  }

  const detail = new Map((accounts.data?.accounts ?? []).map((account) => [account.id, account]));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("note")}</p>
      <ScrollRegion label={t("title")}>
        <Table>
          <caption className="sr-only">{t("title")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("columns.label")}</TableHead>
              <TableHead scope="col">{t("columns.bank")}</TableHead>
              <TableHead scope="col">{t("columns.iban")}</TableHead>
              <TableHead scope="col">{t("columns.balance")}</TableHead>
              <TableHead scope="col">{t("columns.asOf")}</TableHead>
              <TableHead scope="col">{t("columns.feed")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {balances.data.balances.map((balance) => {
              const account = detail.get(balance.bankAccountId);
              return (
                <TableRow key={balance.bankAccountId}>
                  <TableCell>{balance.label}</TableCell>
                  <TableCell>{account?.bankName ?? "—"}</TableCell>
                  <TableCell className="num">
                    {account?.ibanLast4 ? `•••• ${account.ibanLast4}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Money amount={balance.balance} currency={balance.currency} />
                  </TableCell>
                  <TableCell>
                    <DateValue value={balance.asOf} />
                  </TableCell>
                  <TableCell>
                    <DateValue value={account?.feedLastSuccessAt ?? null} withTime />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollRegion>
    </div>
  );
}
