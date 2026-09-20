"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
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
import { DefinitionList, Field, SectionTitle, SelectField } from "./ui";

const KINDS = [
  "received",
  "retained",
  "refunded",
  "transferred",
  "interest",
  "adjustment",
] as const;
const MONEY = /^\d{1,12}([.,]\d{1,2})?$/;

export function DepositTab({ leaseId }: { leaseId: string }) {
  const t = useTranslations("locations");
  const client = useQueryClient();
  const [kind, setKind] = useState("received");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | undefined>(undefined);

  const deposit = useQuery({
    queryKey: ["locations", "deposit", leaseId],
    queryFn: () => rpc.locations.deposits.get({ leaseId }),
  });

  const record = useMutation({
    mutationFn: () =>
      rpc.locations.deposits.record({
        leaseId,
        kind: kind as "received",
        amount: amount.replace(",", "."),
        occurredOn,
      }),
    onSuccess: async () => {
      toast.success(t("deposit.recorded"));
      setAmount("");
      await client.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  const data = deposit.data;

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("deposit.title")}</SectionTitle>
        <DefinitionList
          rows={[
            {
              label: t("deposit.contractual"),
              value: <Money amount={data?.contractualAmount ?? null} />,
            },
            {
              label: t("deposit.balance"),
              value: <Money amount={data?.balanceAmount ?? null} />,
            },
          ]}
        />
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("deposit.record")}</SectionTitle>
        <form
          className="grid gap-4 sm:grid-cols-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!MONEY.test(amount)) {
              setError(t("form.required"));
              return;
            }
            setError(undefined);
            record.mutate();
          }}
        >
          <SelectField
            id="deposit-kind"
            label={t("deposit.kind")}
            value={kind}
            onChange={setKind}
            options={KINDS.map((value) => ({ value, label: t(`depositMovement.${value}`) }))}
          />
          <Field id="deposit-amount" label={t("deposit.amount")} error={error}>
            <Input
              id="deposit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field id="deposit-occurred-on" label={t("deposit.occurredOn")}>
            <Input
              id="deposit-occurred-on"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={record.isPending}>
              <PiggyBank aria-hidden="true" />
              {t("deposit.submit")}
            </Button>
          </div>
        </form>
        {record.error ? <ErrorBox error={errorPayload(record.error)} /> : null}
      </section>

      {data && data.movements.length === 0 ? (
        <EmptyState title={t("deposit.movements")}>{t("empty.deposit")}</EmptyState>
      ) : null}

      {data && data.movements.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.date")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.movements.map((movement) => (
                <TableRow key={movement.id}>
                  <TableCell>
                    <DateValue value={movement.occurredOn} />
                  </TableCell>
                  <TableCell>{t(`depositMovement.${movement.kind}`)}</TableCell>
                  <TableCell>
                    <Money amount={movement.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
