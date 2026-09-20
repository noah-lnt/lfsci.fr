"use client";

import type { ErrorPayload, Loan } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { LoanSchedule as LoanScheduleData } from "@/lib/contracts/finance";
import { errorPayload, rpc } from "@/lib/rpc";
import { Figure, FigureList, type Option, SelectField, TextField } from "./fields";
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
  const [insuranceBasis, setInsuranceBasis] = useState("initial_principal");
  const [deferralMonths, setDeferralMonths] = useState("");
  const [deferralKind, setDeferralKind] = useState("partial");
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
          ? {
              insuranceRate: Number(insuranceRate.replace(",", ".")).toFixed(6),
              insuranceBasis: insuranceBasis as "initial_principal",
            }
          : {}),
        ...(deferralMonths
          ? {
              deferralMonths: Number.parseInt(deferralMonths, 10),
              deferralKind: deferralKind as "partial",
            }
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
          <SelectField
            label={t("insuranceBasis")}
            value={insuranceBasis}
            onChange={setInsuranceBasis}
            options={[
              { value: "initial_principal", label: t("basisInitial") },
              { value: "outstanding_principal", label: t("basisOutstanding") },
            ]}
          />
          <TextField
            label={t("deferralMonths")}
            value={deferralMonths}
            inputMode="numeric"
            onChange={setDeferralMonths}
            hint={t("deferralHint")}
          />
          <SelectField
            label={t("deferralKind")}
            value={deferralKind}
            onChange={setDeferralKind}
            options={[
              { value: "partial", label: t("deferralPartial") },
              { value: "total", label: t("deferralTotal") },
            ]}
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

function LoanSummary({ loan, data }: { loan: Loan | undefined; data: LoanScheduleData }) {
  const t = useTranslations("finance.loans.summary");
  const tBasis = useTranslations("finance.loans.insuranceBasis");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {tBasis(data.insuranceBasis)}
          {data.deferredInstallments > 0
            ? ` · ${t("deferred", { count: data.deferredInstallments })}`
            : null}
        </CardDescription>
        {data.insuranceBasisMismatch ? (
          <p role="status" className="text-sm text-destructive">
            {t("basisMismatch", { stored: tBasis(data.storedInsuranceBasis) })}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <FigureList>
          <Figure
            label={t("outstanding")}
            hint={
              data.progress.outstandingSource === "odoo" ? t("sourceOdoo") : t("sourceProjection")
            }
            testId="loan-outstanding"
          >
            <Money amount={data.progress.outstandingPrincipal} currency={data.currency} />
          </Figure>
          <Figure label={t("capitalRepaid")}>
            <Money amount={data.progress.capitalRepaid} currency={data.currency} />
          </Figure>
          <Figure label={t("interestPaid")}>
            <Money amount={data.progress.interestPaid} currency={data.currency} />
          </Figure>
          <Figure label={t("insurancePaid")}>
            <Money amount={data.progress.insurancePaid} currency={data.currency} />
          </Figure>
        </FigureList>
        <p className="text-sm text-muted-foreground">
          {t("installments", {
            paid: data.progress.installmentsPaid,
            left: data.progress.installmentsLeft,
          })}
          {data.progress.nextDueOn ? (
            <>
              {" · "}
              {t("next")} <DateValue value={data.progress.nextDueOn} /> ·{" "}
              <Money amount={data.progress.nextAmount} currency={data.currency} />
            </>
          ) : null}
          {loan?.releasedOn ? (
            <>
              {" · "}
              {t("releasedOn")} <DateValue value={loan.releasedOn} />
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

function ScheduleVersions({ data }: { data: LoanScheduleData }) {
  const t = useTranslations("finance.loans.versions");
  if (data.versions.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollRegion label={t("title")}>
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("sequence")}</TableHead>
                <TableHead scope="col">{t("reason")}</TableHead>
                <TableHead scope="col">{t("effectiveFrom")}</TableHead>
                <TableHead scope="col">{t("source")}</TableHead>
                <TableHead scope="col">{t("installments")}</TableHead>
                <TableHead scope="col">{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.versions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell className="num">{version.sequence}</TableCell>
                  <TableCell>{t(`reasons.${version.reason}` as "reasons.initial")}</TableCell>
                  <TableCell>
                    <DateValue value={version.effectiveFrom} />
                  </TableCell>
                  <TableCell>
                    {version.source === null
                      ? "—"
                      : t(`sources.${version.source}` as "sources.manual")}
                  </TableCell>
                  <TableCell className="num">{version.installments}</TableCell>
                  <TableCell>
                    <Badge variant={version.id === data.activeVersionId ? "default" : "secondary"}>
                      {t(`statuses.${version.status}` as "statuses.active")}
                    </Badge>
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

function FinancedProperties({ id, data }: { id: string; data: LoanScheduleData }) {
  const t = useTranslations("finance.loans.properties");
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const [share, setShare] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const options: Option[] = [
    ...(lookups.data?.buildings ?? []).map((entry) => ({
      value: `building:${entry.id}`,
      label: entry.label,
    })),
    ...(lookups.data?.units ?? []).map((entry) => ({
      value: `unit:${entry.id}`,
      label: entry.label,
    })),
  ];

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["finance", "loan", id, "installments"] });

  const link = useMutation({
    mutationFn: () => {
      const [kind, targetId] = target.split(":");
      return rpc.finance.loans.linkProperty({
        loanId: id,
        ...(kind === "unit" ? { unitId: targetId } : { buildingId: targetId }),
        ...(share ? { financedShare: (Number(share) / 100).toFixed(6) } : {}),
      });
    },
    onSuccess: async () => {
      setTarget("");
      setShare("");
      await refresh();
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const unlink = useMutation({
    mutationFn: (linkId: string) => rpc.finance.loans.unlinkProperty({ id: linkId }),
    onSuccess: refresh,
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}
        {data.properties.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2">
            {data.properties.map((property) => (
              <li key={property.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {property.label}
                  {property.financedShare
                    ? ` · ${(Number(property.financedShare) * 100).toFixed(2)} %`
                    : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => unlink.mutate(property.id)}
                  disabled={unlink.isPending}
                >
                  {t("remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            link.mutate();
          }}
        >
          <SelectField
            label={t("target")}
            value={target}
            onChange={setTarget}
            options={options}
            placeholder="—"
          />
          <TextField label={t("share")} value={share} inputMode="decimal" onChange={setShare} />
          <Button type="submit" disabled={target === "" || link.isPending}>
            {t("add")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LoanEditor({ loan }: { loan: Loan }) {
  const t = useTranslations("finance.loans.form");
  const tEdit = useTranslations("finance.loans.edit");
  const tStatus = useTranslations("finance.status");
  const queryClient = useQueryClient();
  const [lenderName, setLenderName] = useState(loan.lenderName);
  const [nominalRate, setNominalRate] = useState(
    loan.nominalRate === null ? "" : String(Number(loan.nominalRate)),
  );
  const [insuranceRate, setInsuranceRate] = useState(
    loan.insuranceRate === null ? "" : String(Number(loan.insuranceRate)),
  );
  const [status, setStatus] = useState<string>(loan.status);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: () =>
      rpc.finance.loans.update({
        id: loan.id,
        expectedVersion: loan.version,
        lenderName,
        nominalRate: nominalRate === "" ? null : Number(nominalRate).toFixed(6),
        insuranceRate: insuranceRate === "" ? null : Number(insuranceRate).toFixed(6),
        status: status as "active",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["finance", "loan", loan.id] }),
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tEdit("title")}</CardTitle>
        <CardDescription>{tEdit("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label={t("lender")} value={lenderName} onChange={setLenderName} />
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
          <SelectField
            label={tEdit("status")}
            value={status}
            onChange={setStatus}
            options={(["draft", "active", "renegotiated", "repaid", "cancelled"] as const).map(
              (value) => ({ value, label: tStatus(value) }),
            )}
          />
        </div>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {tEdit("save")}
        </Button>
      </CardContent>
    </Card>
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
    <div className="space-y-6">
      <LoanSummary loan={loan.data} data={data} />
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
      <ScheduleVersions data={data} />
      <FinancedProperties id={id} data={data} />
      {loan.data ? <LoanEditor loan={loan.data} /> : null}
    </div>
  );
}
