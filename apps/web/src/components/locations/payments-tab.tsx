"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, SquareSigma } from "lucide-react";
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
import type { PaymentRead } from "@/lib/contracts/locations";
import { errorPayload, rpc } from "@/lib/rpc";
import { Field, SectionTitle, SelectField } from "./ui";

const METHODS = ["transfer", "direct_debit", "card", "cheque", "cash", "platform"] as const;
const MONEY = /^\d{1,12}([.,]\d{1,2})?$/;

function toNumber(value: string): number {
  return Number(value.replace(",", ".") || "0");
}

export function PaymentsTab({ leaseId }: { leaseId: string }) {
  const t = useTranslations("locations");
  const client = useQueryClient();

  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("transfer");
  const [payerLabel, setPayerLabel] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>(undefined);

  const [allocating, setAllocating] = useState<PaymentRead | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [allocationError, setAllocationError] = useState<string | undefined>(undefined);

  const payments = useQuery({
    queryKey: ["locations", "payments", leaseId],
    queryFn: () => rpc.locations.payments.list({ leaseId, limit: 100 }),
  });
  const terms = useQuery({
    queryKey: ["locations", "terms", leaseId],
    queryFn: () => rpc.locations.rentTerms.list({ leaseId, limit: 100 }),
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ["locations"] });

  const record = useMutation({
    mutationFn: () =>
      rpc.locations.payments.create({
        leaseId,
        amount: amount.replace(",", "."),
        receivedOn,
        method: method as "transfer",
        ...(payerLabel ? { payerLabel } : {}),
      }),
    onSuccess: async () => {
      toast.success(t("payments.recorded"));
      setAmount("");
      setPayerLabel("");
      await invalidate();
    },
  });

  const allocate = useMutation({
    mutationFn: (payment: PaymentRead) =>
      rpc.locations.payments.allocate({
        paymentId: payment.id,
        expectedVersion: payment.version,
        allocations: Object.entries(amounts)
          .filter(([, value]) => toNumber(value) > 0)
          .map(([rentTermId, value]) => ({ rentTermId, amount: value.replace(",", ".") })),
      }),
    onSuccess: async (result) => {
      toast.success(t("payments.allocated"));
      setAllocating(null);
      setAmounts({});
      if (toNumber(result.overpayment) > 0) {
        toast.info(t("payments.overpayment", { amount: result.overpayment }));
      }
      await invalidate();
    },
  });

  const openTerms = (terms.data?.items ?? []).filter((term) => toNumber(term.outstanding) > 0);

  function submitAllocation(payment: PaymentRead) {
    const entries = Object.entries(amounts).filter(([, value]) => toNumber(value) > 0);
    if (entries.length === 0) {
      setAllocationError(t("form.required"));
      return;
    }
    const total = entries.reduce((sum, [, value]) => sum + toNumber(value), 0);
    if (total > toNumber(payment.unallocatedAmount)) {
      setAllocationError(t("payments.remaining", { amount: payment.unallocatedAmount }));
      return;
    }
    const overTerm = entries.find(([termId, value]) => {
      const term = openTerms.find((one) => one.id === termId);
      return term ? toNumber(value) > toNumber(term.outstanding) : true;
    });
    if (overTerm) {
      setAllocationError(t("payments.allocateHint"));
      return;
    }
    setAllocationError(undefined);
    allocate.mutate(payment);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("payments.record")}</SectionTitle>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!MONEY.test(amount)) {
              setAmountError(t("form.required"));
              return;
            }
            setAmountError(undefined);
            record.mutate();
          }}
        >
          <Field id="payment-amount" label={t("payments.amount")} error={amountError}>
            <Input
              id="payment-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
          <Field id="payment-received-on" label={t("payments.receivedOn")}>
            <Input
              id="payment-received-on"
              type="date"
              value={receivedOn}
              onChange={(event) => setReceivedOn(event.target.value)}
            />
          </Field>
          <SelectField
            id="payment-method"
            label={t("payments.method")}
            value={method}
            onChange={setMethod}
            options={METHODS.map((value) => ({ value, label: t(`paymentMethod.${value}`) }))}
          />
          <Field id="payment-payer" label={t("payments.payerLabel")}>
            <Input
              id="payment-payer"
              value={payerLabel}
              onChange={(event) => setPayerLabel(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={record.isPending}>
              <Banknote aria-hidden="true" />
              {t("payments.submit")}
            </Button>
          </div>
        </form>
        {record.error ? <ErrorBox error={errorPayload(record.error)} /> : null}
      </section>

      {payments.data && payments.data.items.length === 0 ? (
        <EmptyState title={t("payments.title")}>{t("empty.payments")}</EmptyState>
      ) : null}

      {payments.data && payments.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.receivedOn")}</TableHead>
                <TableHead>{t("columns.amount")}</TableHead>
                <TableHead>{t("columns.allocated")}</TableHead>
                <TableHead>{t("columns.unallocated")}</TableHead>
                <TableHead>{t("columns.payer")}</TableHead>
                <TableHead>{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.data.items.map((payment) => (
                <TableRow key={payment.id} data-testid="payment-row">
                  <TableCell>
                    <DateValue value={payment.receivedOn} />
                  </TableCell>
                  <TableCell>
                    <Money amount={payment.amount} currency={payment.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={payment.allocatedAmount} currency={payment.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={payment.unallocatedAmount} currency={payment.currency} />
                  </TableCell>
                  <TableCell>
                    {payment.payerLabel ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="allocate-open"
                      disabled={toNumber(payment.unallocatedAmount) === 0}
                      onClick={() => {
                        setAllocating(payment);
                        setAmounts({});
                        setAllocationError(undefined);
                      }}
                    >
                      <SquareSigma aria-hidden="true" />
                      {t("payments.allocate")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {allocating ? (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <SectionTitle>{t("payments.allocateTitle")}</SectionTitle>
          <p className="text-sm text-muted-foreground">{t("payments.allocateHint")}</p>
          <p className="text-sm">
            {t("payments.remaining", { amount: allocating.unallocatedAmount })}
          </p>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submitAllocation(allocating);
            }}
          >
            {openTerms.map((term) => (
              <Field
                key={term.id}
                id={`allocate-${term.id}`}
                label={`${term.periodStart} · ${term.outstanding} ${term.currency}`}
              >
                <Input
                  id={`allocate-${term.id}`}
                  inputMode="decimal"
                  data-testid="allocate-amount"
                  value={amounts[term.id] ?? ""}
                  onChange={(event) =>
                    setAmounts((current) => ({ ...current, [term.id]: event.target.value }))
                  }
                />
              </Field>
            ))}
            {allocationError ? <p className="text-sm text-destructive">{allocationError}</p> : null}
            {allocate.error ? <ErrorBox error={errorPayload(allocate.error)} /> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={allocate.isPending}>
                {t("payments.allocateSubmit")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAllocating(null)}>
                {t("form.cancel")}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
