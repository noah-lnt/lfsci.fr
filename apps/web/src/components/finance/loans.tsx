"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { type Option, SelectField, TextField } from "./fields";
import { ScrollRegion } from "./scroll-region";

export function LoansTable() {
  const t = useTranslations("finance.loans");
  const tStatus = useTranslations("finance.status");
  const loans = useQuery({
    queryKey: ["finance", "loans"],
    queryFn: () => rpc.finance.loans.list({ limit: 50 }),
  });

  if (loans.isError) return <ErrorBox error={errorPayload(loans.error)} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href="/finance/credits/nouveau" className={buttonVariants()}>
          {t("new")}
        </Link>
      </div>

      {loans.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {loans.data && loans.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {loans.data && loans.data.items.length > 0 ? (
        <ScrollRegion label={t("title")}>
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.lender")}</TableHead>
                <TableHead scope="col">{t("columns.reference")}</TableHead>
                <TableHead scope="col">{t("columns.principal")}</TableHead>
                <TableHead scope="col">{t("columns.rate")}</TableHead>
                <TableHead scope="col">{t("columns.duration")}</TableHead>
                <TableHead scope="col">{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.data.items.map((loan) => (
                <TableRow key={loan.id}>
                  <TableCell>
                    <Link
                      className="underline underline-offset-2"
                      href={`/finance/credits/${loan.id}`}
                    >
                      {loan.lenderName}
                    </Link>
                  </TableCell>
                  <TableCell className="num">{loan.reference}</TableCell>
                  <TableCell>
                    <Money amount={loan.principalAmount} currency={loan.currency} />
                  </TableCell>
                  <TableCell className="num">
                    {loan.nominalRate ? `${Number(loan.nominalRate)} %` : "—"}
                  </TableCell>
                  <TableCell className="num">{loan.durationMonths ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tStatus(loan.status)}</Badge>
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

export function LoanForm() {
  const t = useTranslations("finance.loans.form");
  const router = useRouter();
  const [legalEntityId, setLegalEntityId] = useState("");
  const [lenderName, setLenderName] = useState("");
  const [reference, setReference] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [durationMonths, setDurationMonths] = useState("");
  const [nominalRate, setNominalRate] = useState("");
  const [insuranceRate, setInsuranceRate] = useState("");
  const [firstDueOn, setFirstDueOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const entityOptions: Option[] = (lookups.data?.legalEntities ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const create = useMutation({
    mutationFn: () =>
      rpc.finance.loans.create({
        legalEntityId,
        lenderName,
        reference,
        principalAmount: Number(principalAmount.replace(",", ".")).toFixed(2),
        durationMonths: Number.parseInt(durationMonths, 10),
        firstDueOn,
        ...(nominalRate ? { nominalRate: Number(nominalRate.replace(",", ".")).toFixed(6) } : {}),
        ...(insuranceRate
          ? { insuranceRate: Number(insuranceRate.replace(",", ".")).toFixed(6) }
          : {}),
      }),
    onSuccess: (loan) => router.push(`/finance/credits/${loan.id}`),
    onError: (cause) => setError(errorPayload(cause)),
  });

  const complete =
    legalEntityId !== "" &&
    lenderName !== "" &&
    reference !== "" &&
    /^\d+([.,]\d{1,2})?$/.test(principalAmount) &&
    /^\d+$/.test(durationMonths);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      {error ? <ErrorBox error={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label={t("legalEntity")}
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={entityOptions}
            placeholder="—"
          />
          <TextField label={t("lender")} value={lenderName} onChange={setLenderName} />
          <TextField label={t("reference")} value={reference} onChange={setReference} />
          <TextField
            label={t("principal")}
            value={principalAmount}
            inputMode="decimal"
            onChange={setPrincipalAmount}
          />
          <TextField
            label={t("durationMonths")}
            value={durationMonths}
            inputMode="numeric"
            onChange={setDurationMonths}
          />
          <TextField
            label={t("nominalRate")}
            value={nominalRate}
            inputMode="decimal"
            onChange={setNominalRate}
          />
          <TextField
            label={t("insuranceRate")}
            value={insuranceRate}
            inputMode="decimal"
            onChange={setInsuranceRate}
          />
          <TextField
            label={t("firstDueOn")}
            type="date"
            value={firstDueOn}
            onChange={setFirstDueOn}
          />
        </CardContent>
      </Card>
      <Button type="submit" size="lg" disabled={!complete || create.isPending}>
        {create.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

export function LoanSchedule({ id }: { id: string }) {
  const t = useTranslations("finance.loans.schedule");
  const loan = useQuery({
    queryKey: ["finance", "loan", id],
    queryFn: () => rpc.finance.loans.get({ id }),
  });
  const schedule = useQuery({
    queryKey: ["finance", "loan", id, "installments"],
    queryFn: () => rpc.finance.loans.installments({ id }),
  });

  if (schedule.isError) return <ErrorBox error={errorPayload(schedule.error)} />;
  if (!schedule.data) return <Skeleton className="h-64 w-full" />;
  const data = schedule.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {loan.data ? `${loan.data.lenderName} · ${loan.data.reference}` : t("title")}
        </CardTitle>
        <CardDescription data-testid="schedule-sum">
          {data.principalMatchesLoan ? t("sumOk") : t("sumKo")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.installments.length === 0 ? (
          <p className="text-sm">{t("empty")}</p>
        ) : (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("number")}</TableHead>
                  <TableHead scope="col">{t("dueOn")}</TableHead>
                  <TableHead scope="col">{t("principal")}</TableHead>
                  <TableHead scope="col">{t("interest")}</TableHead>
                  <TableHead scope="col">{t("insurance")}</TableHead>
                  <TableHead scope="col">{t("fees")}</TableHead>
                  <TableHead scope="col">{t("total")}</TableHead>
                  <TableHead scope="col">{t("remaining")}</TableHead>
                  <TableHead scope="col">{t("match")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.installments.map((installment) => (
                  <TableRow key={installment.id}>
                    <TableCell className="num">{installment.installmentNumber}</TableCell>
                    <TableCell>
                      <DateValue value={installment.dueOn} />
                    </TableCell>
                    <TableCell>
                      <Money amount={installment.principalAmount} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={installment.interestAmount} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={installment.insuranceAmount} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={installment.feesAmount} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={installment.totalAmount} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={installment.remainingPrincipal} currency={data.currency} />
                    </TableCell>
                    <TableCell>
                      {installment.matchStatus === "exact"
                        ? t("matchExact")
                        : installment.matchStatus === "amount_mismatch"
                          ? `${t("matchMismatch")} ${installment.matchDifference ?? ""}`
                          : t("matchNone")}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={2}>
                    <strong>{t("totals")}</strong>
                  </TableCell>
                  <TableCell data-testid="total-principal">
                    <Money amount={data.totalPrincipal} currency={data.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={data.totalInterest} currency={data.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={data.totalInsurance} currency={data.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={data.totalFees} currency={data.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={data.totalPaid} currency={data.currency} />
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </ScrollRegion>
        )}
      </CardContent>
    </Card>
  );
}
