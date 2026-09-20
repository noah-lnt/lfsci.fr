"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { type Option, SelectField, TextAreaField, TextField } from "./fields";
import { ScrollRegion } from "./scroll-region";

const KINDS = [
  "contribution",
  "expense_paid_personally",
  "repayment",
  "interest",
  "offset",
  "correction",
] as const;

function RecordMovementForm({ accounts }: { accounts: readonly Option[] }) {
  const t = useTranslations("finance.cca.form");
  const tKinds = useTranslations("finance.cca.kinds");
  const queryClient = useQueryClient();
  const [ccaId, setCcaId] = useState(accounts[0]?.value ?? "");
  const [kind, setKind] = useState<string>("contribution");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [justification, setJustification] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: () =>
      rpc.finance.cca.record({
        ccaId,
        kind: kind as "contribution",
        amount: Number(amount.replace(",", ".")).toFixed(2),
        occurredOn,
        justification,
      }),
    onSuccess: async (result) => {
      setError(null);
      setLevel(result.decisionLevel);
      setAmount("");
      setJustification("");
      await queryClient.invalidateQueries({ queryKey: ["finance", "cca"] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const complete =
    ccaId !== "" && /^\d+([.,]\d{1,2})?$/.test(amount) && justification.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            record.mutate();
          }}
        >
          {error ? <ErrorBox error={error} /> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t("account")}
              value={ccaId}
              onChange={setCcaId}
              options={accounts}
              placeholder="—"
            />
            <SelectField
              label={t("kind")}
              value={kind}
              onChange={setKind}
              options={KINDS.map((value) => ({ value, label: tKinds(value) }))}
            />
            <TextField
              label={t("amount")}
              value={amount}
              inputMode="decimal"
              onChange={setAmount}
            />
            <TextField
              label={t("occurredOn")}
              type="date"
              value={occurredOn}
              onChange={setOccurredOn}
            />
          </div>
          <TextAreaField
            label={t("justification")}
            value={justification}
            onChange={setJustification}
          />
          <Button type="submit" disabled={!complete || record.isPending}>
            {record.isPending ? t("submitting") : t("submit")}
          </Button>
          {level ? (
            <p role="status" className="text-sm" data-testid="cca-outcome">
              {t("recorded", { level })}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function AccountLedger({ id }: { id: string }) {
  const t = useTranslations("finance.cca");
  const tKinds = useTranslations("finance.cca.kinds");
  const tStatus = useTranslations("finance.status");
  const ledger = useQuery({
    queryKey: ["finance", "cca", id],
    queryFn: () => rpc.finance.cca.get({ id }),
  });

  if (ledger.isError) return <ErrorBox error={errorPayload(ledger.error)} />;
  if (!ledger.data) return <Skeleton className="h-40 w-full" />;
  const data = ledger.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.partnerName}</CardTitle>
        <CardDescription>
          {t("balance")} : <Money amount={data.balance} currency={data.account.currency} /> ·{" "}
          {t(`direction.${data.direction}` as "direction.settled")}
          {data.odooBalance ? (
            <>
              {" · "}
              {t("odooBalance")} :{" "}
              <Money amount={data.odooBalance} currency={data.account.currency} />
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollRegion label={data.partnerName}>
          <Table>
            <caption className="sr-only">{data.partnerName}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.occurredOn")}</TableHead>
                <TableHead scope="col">{t("columns.kind")}</TableHead>
                <TableHead scope="col">{t("columns.amount")}</TableHead>
                <TableHead scope="col">{t("columns.balance")}</TableHead>
                <TableHead scope="col">{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <DateValue value={entry.occurredOn} />
                  </TableCell>
                  <TableCell>{tKinds(entry.kind as "contribution")}</TableCell>
                  <TableCell>
                    <Money amount={entry.amount} currency={data.account.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={entry.balance} currency={data.account.currency} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tStatus(entry.status as "proposed")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      </CardContent>
    </Card>
  );
}

export function CcaView() {
  const t = useTranslations("finance.cca");
  const accounts = useQuery({
    queryKey: ["finance", "cca", "list"],
    queryFn: () => rpc.finance.cca.list({ limit: 50 }),
  });
  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });

  if (accounts.isError) return <ErrorBox error={errorPayload(accounts.error)} />;

  const options: Option[] = (lookups.data?.ccaAccounts ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  return (
    <div className="space-y-6">
      {accounts.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {accounts.data && accounts.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {(accounts.data?.items ?? []).map((account) => (
        <AccountLedger key={account.id} id={account.id} />
      ))}

      {options.length > 0 ? <RecordMovementForm accounts={options} /> : null}
    </div>
  );
}
