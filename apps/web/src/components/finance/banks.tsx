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
import type { BankAccountSummary, BankOverview } from "@/lib/contracts/finance";
import { errorPayload, rpc } from "@/lib/rpc";
import { Figure, FigureList, type Option, SelectField, TextField } from "./fields";
import { ScrollRegion } from "./scroll-region";

const decimalInput = /^-?\d+([.,]\d{1,2})?$/;

function toMoney(value: string): string {
  return Number(value.replace(",", ".")).toFixed(2);
}

const PURPOSES = ["operating", "deposit", "transit", "savings", "loan"] as const;

function AccountForm({
  account,
  onDone,
}: {
  account: BankAccountSummary | null;
  onDone: () => void;
}) {
  const t = useTranslations("finance.banks.form");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [label, setLabel] = useState(account?.label ?? "");
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [purpose, setPurpose] = useState(account?.purpose ?? "operating");
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalance ?? "0.00");
  const [openingBalanceOn, setOpeningBalanceOn] = useState(account?.openingBalanceOn ?? "");
  const [error, setError] = useState<ErrorPayload | null>(null);
  const queryClient = useQueryClient();
  const tPurpose = useTranslations("finance.banks.purpose");

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const entities: Option[] = (lookups.data?.legalEntities ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const submit = useMutation({
    mutationFn: async () => {
      if (account) {
        return rpc.finance.bank.updateAccount({
          id: account.id,
          expectedVersion: account.version,
          label,
          bankName: bankName === "" ? null : bankName,
          purpose: purpose as "operating",
          openingBalance: toMoney(openingBalance),
          openingBalanceOn: openingBalanceOn === "" ? null : openingBalanceOn,
        });
      }
      return rpc.finance.bank.createAccount({
        legalEntityId,
        label,
        purpose: purpose as "operating",
        openingBalance: toMoney(openingBalance),
        ...(bankName ? { bankName } : {}),
        ...(openingBalanceOn ? { openingBalanceOn } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["finance", "bank"] });
      onDone();
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const complete =
    label !== "" && decimalInput.test(openingBalance) && (account !== null || legalEntityId !== "");

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      {error ? <ErrorBox error={error} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {account === null ? (
          <SelectField
            label={t("legalEntity")}
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={entities}
            placeholder="—"
          />
        ) : null}
        <TextField label={t("label")} value={label} onChange={setLabel} />
        <TextField label={t("bank")} value={bankName} onChange={setBankName} />
        <SelectField
          label={t("purpose")}
          value={purpose}
          onChange={setPurpose}
          options={PURPOSES.map((value) => ({ value, label: tPurpose(value) }))}
        />
        <TextField
          label={t("openingBalance")}
          value={openingBalance}
          inputMode="decimal"
          onChange={setOpeningBalance}
          hint={t("openingHint")}
        />
        <TextField
          label={t("openingBalanceOn")}
          type="date"
          value={openingBalanceOn}
          onChange={setOpeningBalanceOn}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={!complete || submit.isPending}>
          {account ? t("save") : t("create")}
        </Button>
        {account ? (
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function TransferForm({ overview }: { overview: BankOverview }) {
  const t = useTranslations("finance.banks.transfers");
  const queryClient = useQueryClient();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [initiatedOn, setInitiatedOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<ErrorPayload | null>(null);

  const options: Option[] = overview.accounts.map((account) => ({
    value: account.id,
    label: account.label,
  }));
  const legalEntityId = overview.accounts.find((account) => account.id === source)?.legalEntityId;

  const create = useMutation({
    mutationFn: () =>
      rpc.finance.bank.createTransfer({
        legalEntityId: legalEntityId as string,
        sourceBankAccountId: source,
        targetBankAccountId: target,
        amount: toMoney(amount),
        initiatedOn,
      }),
    onSuccess: async () => {
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["finance", "bank"] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      {error ? <ErrorBox error={error} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          label={t("source")}
          value={source}
          onChange={setSource}
          options={options}
          placeholder="—"
        />
        <SelectField
          label={t("target")}
          value={target}
          onChange={setTarget}
          options={options}
          placeholder="—"
        />
        <TextField label={t("amount")} value={amount} inputMode="decimal" onChange={setAmount} />
        <TextField
          label={t("initiatedOn")}
          type="date"
          value={initiatedOn}
          onChange={setInitiatedOn}
        />
      </div>
      <Button
        type="submit"
        disabled={
          source === "" ||
          target === "" ||
          source === target ||
          !decimalInput.test(amount) ||
          legalEntityId === undefined ||
          create.isPending
        }
      >
        {t("create")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </form>
  );
}

function TransfersTable({ overview }: { overview: BankOverview }) {
  const t = useTranslations("finance.banks.transfers");
  const tStatus = useTranslations("finance.banks.transferStatus");
  const queryClient = useQueryClient();
  const settle = useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      rpc.finance.bank.updateTransfer({
        ...input,
        status: "settled",
        settledOn: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance", "bank"] }),
  });
  const cancel = useMutation({
    mutationFn: (input: { id: string; expectedVersion: number }) =>
      rpc.finance.bank.updateTransfer({ ...input, status: "cancelled" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance", "bank"] }),
  });

  if (overview.transfers.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ScrollRegion label={t("title")}>
      <Table>
        <caption className="sr-only">{t("title")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("initiatedOn")}</TableHead>
            <TableHead scope="col">{t("source")}</TableHead>
            <TableHead scope="col">{t("target")}</TableHead>
            <TableHead scope="col">{t("amount")}</TableHead>
            <TableHead scope="col">{t("status")}</TableHead>
            <TableHead scope="col">{t("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overview.transfers.map((transfer) => (
            <TableRow key={transfer.id}>
              <TableCell>
                <DateValue value={transfer.initiatedOn} />
              </TableCell>
              <TableCell>{transfer.sourceLabel}</TableCell>
              <TableCell>{transfer.targetLabel}</TableCell>
              <TableCell>
                <Money amount={transfer.amount} currency={transfer.currency} />
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{tStatus(transfer.status as "settled")}</Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={transfer.status === "settled" || settle.isPending}
                    onClick={() =>
                      settle.mutate({ id: transfer.id, expectedVersion: transfer.version })
                    }
                  >
                    {t("settle")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={transfer.status === "cancelled" || cancel.isPending}
                    onClick={() =>
                      cancel.mutate({ id: transfer.id, expectedVersion: transfer.version })
                    }
                  >
                    {t("cancel")}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  );
}

function TransactionsTable({ accounts }: { accounts: readonly Option[] }) {
  const t = useTranslations("finance.banks.transactions");
  const [bankAccountId, setBankAccountId] = useState("");
  const transactions = useQuery({
    queryKey: ["finance", "bank", "transactions", bankAccountId],
    queryFn: () =>
      rpc.finance.bank.transactions({
        limit: 50,
        ...(bankAccountId ? { bankAccountId } : {}),
      }),
  });

  return (
    <div className="space-y-4">
      <SelectField
        label={t("filter")}
        value={bankAccountId}
        onChange={setBankAccountId}
        options={[{ value: "", label: t("allAccounts") }, ...accounts]}
        className="max-w-xs space-y-1.5"
      />
      {transactions.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {transactions.data && transactions.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : null}
      {transactions.data && transactions.data.items.length > 0 ? (
        <ScrollRegion label={t("title")}>
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("bookedOn")}</TableHead>
                <TableHead scope="col">{t("valueOn")}</TableHead>
                <TableHead scope="col">{t("label")}</TableHead>
                <TableHead scope="col">{t("counterparty")}</TableHead>
                <TableHead scope="col">{t("amount")}</TableHead>
                <TableHead scope="col">{t("origin")}</TableHead>
                <TableHead scope="col">{t("reconciliation")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <DateValue value={row.bookedOn} />
                  </TableCell>
                  <TableCell>
                    <DateValue value={row.valueOn} />
                  </TableCell>
                  <TableCell>{row.label ?? "—"}</TableCell>
                  <TableCell>{row.counterpartyName ?? "—"}</TableCell>
                  <TableCell>
                    <Money amount={row.amount} currency={row.currency} />
                  </TableCell>
                  <TableCell>{row.fromLedger ? t("ledger") : t("imported")}</TableCell>
                  <TableCell>
                    {t(`status.${row.reconciliationStatus}` as "status.excluded")}
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

export function BanksView() {
  const t = useTranslations("finance.banks");
  const tBasis = useTranslations("finance.banks.basis");
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const overview = useQuery({
    queryKey: ["finance", "bank", "overview"],
    queryFn: () => rpc.finance.bank.overview({}),
  });

  if (overview.isError) return <ErrorBox error={errorPayload(overview.error)} />;
  if (!overview.data) return <Skeleton className="h-64 w-full" />;
  const data = overview.data;
  const balanceById = new Map(data.balances.map((balance) => [balance.bankAccountId, balance]));
  const accountOptions: Option[] = data.accounts.map((account) => ({
    value: account.id,
    label: account.label,
  }));
  const edited = data.accounts.find((account) => account.id === editing) ?? null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("total")}</CardTitle>
          <CardDescription>{t("note")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FigureList>
            <Figure label={t("total")} hint={tBasis(data.totalBasis)} testId="bank-total">
              <Money amount={data.total} currency={data.currency} />
            </Figure>
            <Figure label={t("accounts")}>{data.accounts.length}</Figure>
            <Figure label={t("unreconciled")}>{data.unreconciled}</Figure>
            <Figure label={t("asOf")}>
              <DateValue value={data.asOf} />
            </Figure>
          </FigureList>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.accounts.length === 0 ? (
            <EmptyState title={t("title")}>{t("empty")}</EmptyState>
          ) : (
            <ScrollRegion label={t("title")}>
              <Table>
                <caption className="sr-only">{t("title")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("columns.label")}</TableHead>
                    <TableHead scope="col">{t("columns.bank")}</TableHead>
                    <TableHead scope="col">{t("columns.iban")}</TableHead>
                    <TableHead scope="col">{t("columns.balance")}</TableHead>
                    <TableHead scope="col">{t("columns.source")}</TableHead>
                    <TableHead scope="col">{t("columns.asOf")}</TableHead>
                    <TableHead scope="col">{t("columns.feed")}</TableHead>
                    <TableHead scope="col">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.accounts.map((account) => {
                    const balance = balanceById.get(account.id);
                    return (
                      <TableRow key={account.id}>
                        <TableCell>{account.label}</TableCell>
                        <TableCell>{account.bankName ?? "—"}</TableCell>
                        <TableCell className="num">
                          {account.ibanLast4 ? `•••• ${account.ibanLast4}` : "—"}
                        </TableCell>
                        <TableCell data-testid="bank-balance">
                          <Money amount={balance?.balance} currency={account.currency} />
                        </TableCell>
                        <TableCell>
                          {balance ? (
                            <Badge variant={balance.basis === "ledger" ? "default" : "outline"}>
                              {tBasis(balance.basis)}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <DateValue value={balance?.asOf ?? null} />
                        </TableCell>
                        <TableCell>
                          <DateValue value={account.feedLastSuccessAt} withTime />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCreating(false);
                              setEditing(account.id);
                            }}
                          >
                            {t("edit")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}

          {edited ? (
            <AccountForm key={edited.id} account={edited} onDone={() => setEditing(null)} />
          ) : creating ? (
            <AccountForm account={null} onDone={() => setCreating(false)} />
          ) : (
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setCreating(true);
              }}
            >
              {t("new")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("transfers.title")}</CardTitle>
          <CardDescription>{t("transfers.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TransfersTable overview={data} />
          {data.accounts.length > 1 ? <TransferForm overview={data} /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("transactions.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionsTable accounts={accountOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
