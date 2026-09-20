"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { type Option, SelectField, TextAreaField, TextField } from "@/components/finance/fields";
import { ScrollRegion } from "@/components/finance/scroll-region";
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
import type { CertificateState } from "@/lib/contracts/assurances";
import { errorPayload, rpc } from "@/lib/rpc";

const KINDS = [
  "pno",
  "habitation",
  "borrower",
  "liability",
  "works",
  "multirisk",
  "other",
] as const;
const STATUSES = ["draft", "active", "expiring", "expired", "cancelled", "to_verify"] as const;
const PERIODICITIES = ["monthly", "quarterly", "yearly", "single"] as const;

export function certificateVariant(state: CertificateState) {
  if (state === "missing" || state === "expired") return "destructive" as const;
  if (state === "expiring") return "outline" as const;
  return "secondary" as const;
}

function ExceptionsCard() {
  const t = useTranslations("assurances.exceptions");
  const tState = useTranslations("assurances.certificateState");

  const exceptions = useQuery({
    queryKey: ["assurances", "exceptions"],
    queryFn: () => rpc.assurances.policies.exceptions({}),
  });

  if (exceptions.isError) return <ErrorBox error={errorPayload(exceptions.error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {exceptions.isPending ? <Skeleton className="h-20 w-full" /> : null}
        {exceptions.data && exceptions.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="assurances-no-exception">
            {t("empty")}
          </p>
        ) : null}
        {exceptions.data && exceptions.data.items.length > 0 ? (
          <ScrollRegion label={t("title")}>
            <Table data-testid="assurances-exceptions">
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.policy")}</TableHead>
                  <TableHead scope="col">{t("columns.state")}</TableHead>
                  <TableHead scope="col">{t("columns.endsOn")}</TableHead>
                  <TableHead scope="col">{t("columns.scope")}</TableHead>
                  <TableHead scope="col">{t("act")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.data.items.map((row) => (
                  <TableRow key={row.policyId}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell>
                      <Badge variant={certificateVariant(row.certificateState)}>
                        {tState(row.certificateState)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DateValue value={row.coverEndsOn} />
                    </TableCell>
                    <TableCell>
                      {row.scopeLabels.length > 0 ? row.scopeLabels.join(", ") : "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        className="underline underline-offset-2"
                        href={`/patrimoine/assurances/${row.policyId}`}
                      >
                        {t("act")}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PoliciesTable() {
  const t = useTranslations("assurances");
  const tKind = useTranslations("assurances.kind");
  const tStatus = useTranslations("assurances.status");
  const tState = useTranslations("assurances.certificateState");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");

  const policies = useQuery({
    queryKey: ["assurances", "policies", kind, status],
    queryFn: () =>
      rpc.assurances.policies.list({
        limit: 50,
        ...(kind ? { kind: kind as "pno" } : {}),
        ...(status ? { status: status as "active" } : {}),
      }),
  });

  if (policies.isError) return <ErrorBox error={errorPayload(policies.error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-[14rem_14rem]">
          <SelectField
            label={t("filters.kind")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "", label: t("all") },
              ...KINDS.map((value) => ({ value, label: tKind(value) })),
            ]}
            placeholder={t("all")}
          />
          <SelectField
            label={t("filters.status")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t("all") },
              ...STATUSES.map((value) => ({ value, label: tStatus(value) })),
            ]}
            placeholder={t("all")}
          />
        </div>
      </CardHeader>
      <CardContent>
        {policies.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {policies.data && policies.data.items.length === 0 ? (
          <EmptyState title={t("title")}>{t("empty")}</EmptyState>
        ) : null}
        {policies.data && policies.data.items.length > 0 ? (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.insurer")}</TableHead>
                  <TableHead scope="col">{t("columns.number")}</TableHead>
                  <TableHead scope="col">{t("columns.kind")}</TableHead>
                  <TableHead scope="col">{t("columns.scope")}</TableHead>
                  <TableHead scope="col">{t("columns.period")}</TableHead>
                  <TableHead scope="col">{t("columns.premium")}</TableHead>
                  <TableHead scope="col">{t("columns.certificate")}</TableHead>
                  <TableHead scope="col">{t("columns.claims")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.data.items.map((policy) => (
                  <TableRow key={policy.id}>
                    <TableCell>
                      <Link
                        className="underline underline-offset-2"
                        href={`/patrimoine/assurances/${policy.id}`}
                      >
                        {policy.insurerName}
                      </Link>
                    </TableCell>
                    <TableCell className="num">{policy.policyNumber}</TableCell>
                    <TableCell>{tKind(policy.kind)}</TableCell>
                    <TableCell>
                      {policy.scopeLabels.length > 0 ? policy.scopeLabels.join(", ") : "—"}
                    </TableCell>
                    <TableCell>
                      <DateValue value={policy.startsOn} /> → <DateValue value={policy.endsOn} />
                    </TableCell>
                    <TableCell>
                      <Money amount={policy.premiumAmount} currency={policy.currency} />
                    </TableCell>
                    <TableCell>
                      <Badge variant={certificateVariant(policy.certificateState)}>
                        {tState(policy.certificateState)}
                      </Badge>
                    </TableCell>
                    <TableCell className="num">{policy.claimCount}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tStatus(policy.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CreatePolicyForm() {
  const t = useTranslations("assurances.form");
  const tKind = useTranslations("assurances.kind");
  const tPeriodicity = useTranslations("assurances.periodicity");
  const router = useRouter();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState("pno");
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [premiumAmount, setPremiumAmount] = useState("");
  const [premiumPeriodicity, setPremiumPeriodicity] = useState("yearly");
  const [deductibleAmount, setDeductibleAmount] = useState("");
  const [guarantees, setGuarantees] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["assurances", "lookups"],
    queryFn: () => rpc.assurances.lookups({}),
  });
  const entityOptions: Option[] = [
    { value: "", label: "—" },
    ...(lookups.data?.legalEntities ?? []).map((entry) => ({
      value: entry.id,
      label: entry.label,
    })),
  ];

  const create = useMutation({
    mutationFn: () =>
      rpc.assurances.policies.create({
        kind: kind as "pno",
        insurerName,
        policyNumber,
        ...(legalEntityId ? { legalEntityId } : {}),
        ...(startsOn ? { startsOn } : {}),
        ...(endsOn ? { endsOn } : {}),
        ...(premiumAmount
          ? { premiumAmount: Number(premiumAmount.replace(",", ".")).toFixed(2) }
          : {}),
        ...(premiumPeriodicity ? { premiumPeriodicity: premiumPeriodicity as "yearly" } : {}),
        ...(deductibleAmount
          ? { deductibleAmount: Number(deductibleAmount.replace(",", ".")).toFixed(2) }
          : {}),
        ...(guarantees ? { guaranteesSummary: guarantees } : {}),
        ...(exclusions ? { exclusionsSummary: exclusions } : {}),
      }),
    onSuccess: async (policy) => {
      await queryClient.invalidateQueries({ queryKey: ["assurances"] });
      router.push(`/patrimoine/assurances/${policy.id}`);
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("createTitle")}</CardTitle>
        <CardDescription>{t("deadlineNote")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          {error ? <ErrorBox error={error} /> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t("kind")}
              value={kind}
              onChange={setKind}
              options={KINDS.map((value) => ({ value, label: tKind(value) }))}
            />
            <SelectField
              label={t("legalEntity")}
              value={legalEntityId}
              onChange={setLegalEntityId}
              options={entityOptions}
              placeholder="—"
            />
            <TextField label={t("insurerName")} value={insurerName} onChange={setInsurerName} />
            <TextField label={t("policyNumber")} value={policyNumber} onChange={setPolicyNumber} />
            <TextField label={t("startsOn")} type="date" value={startsOn} onChange={setStartsOn} />
            <TextField label={t("endsOn")} type="date" value={endsOn} onChange={setEndsOn} />
            <TextField
              label={t("premiumAmount")}
              value={premiumAmount}
              inputMode="decimal"
              onChange={setPremiumAmount}
            />
            <SelectField
              label={t("premiumPeriodicity")}
              value={premiumPeriodicity}
              onChange={setPremiumPeriodicity}
              options={PERIODICITIES.map((value) => ({ value, label: tPeriodicity(value) }))}
            />
            <TextField
              label={t("deductibleAmount")}
              value={deductibleAmount}
              inputMode="decimal"
              onChange={setDeductibleAmount}
            />
          </div>
          <TextAreaField label={t("guarantees")} value={guarantees} onChange={setGuarantees} />
          <TextAreaField label={t("exclusions")} value={exclusions} onChange={setExclusions} />
          <Button
            type="submit"
            disabled={insurerName === "" || policyNumber === "" || create.isPending}
          >
            {create.isPending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PoliciesView() {
  return (
    <div className="space-y-6">
      <ExceptionsCard />
      <PoliciesTable />
      <CreatePolicyForm />
    </div>
  );
}
