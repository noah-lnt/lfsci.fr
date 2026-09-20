"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DocumentPanel } from "@/components/documents/document-panel";
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
import type { PolicyDetail as PolicyDetailData, PolicyScopeRow } from "@/lib/contracts/assurances";
import { errorPayload, rpc } from "@/lib/rpc";
import { certificateVariant } from "./policies-view";

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
const SCOPE_KINDS = ["building", "unit", "equipment", "lease", "loan"] as const;

function todayIso(): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

function EditForm({ policy, onSaved }: { policy: PolicyDetailData; onSaved: () => void }) {
  const t = useTranslations("assurances.form");
  const tKind = useTranslations("assurances.kind");
  const tStatus = useTranslations("assurances.status");
  const tPeriodicity = useTranslations("assurances.periodicity");

  const [kind, setKind] = useState(policy.kind as string);
  const [insurerName, setInsurerName] = useState(policy.insurerName);
  const [policyNumber, setPolicyNumber] = useState(policy.policyNumber);
  const [startsOn, setStartsOn] = useState(policy.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(policy.endsOn ?? "");
  const [premiumAmount, setPremiumAmount] = useState(policy.premiumAmount ?? "");
  const [premiumPeriodicity, setPremiumPeriodicity] = useState(policy.premiumPeriodicity ?? "");
  const [deductibleAmount, setDeductibleAmount] = useState(policy.deductibleAmount ?? "");
  const [guarantees, setGuarantees] = useState(policy.guaranteesSummary ?? "");
  const [exclusions, setExclusions] = useState(policy.exclusionsSummary ?? "");
  const [status, setStatus] = useState(policy.status as string);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: () =>
      rpc.assurances.policies.update({
        id: policy.id,
        expectedVersion: policy.version,
        kind: kind as "pno",
        insurerName,
        policyNumber,
        startsOn: startsOn === "" ? null : startsOn,
        endsOn: endsOn === "" ? null : endsOn,
        premiumAmount:
          premiumAmount === "" ? null : Number(premiumAmount.replace(",", ".")).toFixed(2),
        premiumPeriodicity: premiumPeriodicity === "" ? null : (premiumPeriodicity as "yearly"),
        deductibleAmount:
          deductibleAmount === "" ? null : Number(deductibleAmount.replace(",", ".")).toFixed(2),
        guaranteesSummary: guarantees === "" ? null : guarantees,
        exclusionsSummary: exclusions === "" ? null : exclusions,
        status: status as "active",
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("editTitle")}</CardTitle>
        <CardDescription>{t("deadlineNote")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate();
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
              label={t("status")}
              value={status}
              onChange={setStatus}
              options={STATUSES.map((value) => ({ value, label: tStatus(value) }))}
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
              placeholder="—"
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
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("submitting") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ScopesCard({
  policy,
  onChanged,
}: {
  policy: PolicyDetailData;
  onChanged: (change: "added" | "closed") => void;
}) {
  const t = useTranslations("assurances.detail");
  const tScopeKind = useTranslations("assurances.scopeKind");
  const [targetKind, setTargetKind] = useState("unit");
  const [targetId, setTargetId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["assurances", "lookups"],
    queryFn: () => rpc.assurances.lookups({}),
  });

  const targets: Option[] = [
    { value: "", label: "—" },
    ...(
      (targetKind === "building"
        ? lookups.data?.buildings
        : targetKind === "unit"
          ? lookups.data?.units
          : targetKind === "equipment"
            ? lookups.data?.equipment
            : targetKind === "lease"
              ? lookups.data?.leases
              : lookups.data?.loans) ?? []
    ).map((entry) => ({ value: entry.id, label: entry.label })),
  ];

  const add = useMutation({
    mutationFn: () =>
      rpc.assurances.policies.scopes.add({
        policyId: policy.id,
        targetKind: targetKind as "unit",
        targetId,
        ...(startsOn ? { startsOn } : {}),
      }),
    onSuccess: () => {
      setTargetId("");
      setStartsOn("");
      onChanged("added");
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const close = useMutation({
    mutationFn: (scope: PolicyScopeRow) =>
      rpc.assurances.policies.scopes.close({
        policyId: policy.id,
        scopeId: scope.id,
        expectedVersion: scope.version,
        endsOn: todayIso(),
      }),
    onSuccess: () => onChanged("closed"),
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("scopes")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}
        {policy.scopes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noScope")}</p>
        ) : (
          <ScrollRegion label={t("scopes")}>
            <Table data-testid="policy-scopes">
              <caption className="sr-only">{t("scopes")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("scopeKind")}</TableHead>
                  <TableHead scope="col">{t("scopeTarget")}</TableHead>
                  <TableHead scope="col">{t("scopeStartsOn")}</TableHead>
                  <TableHead scope="col">{t("scopeEnd")}</TableHead>
                  <TableHead scope="col">{t("closeScope")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policy.scopes.map((scope) => (
                  <TableRow key={scope.id}>
                    <TableCell>{tScopeKind(scope.targetKind)}</TableCell>
                    <TableCell>{scope.label}</TableCell>
                    <TableCell>
                      <DateValue value={scope.startsOn} />
                    </TableCell>
                    <TableCell>
                      <DateValue value={scope.endsOn} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={scope.endsOn !== null || close.isPending}
                        onClick={() => close.mutate(scope)}
                      >
                        {t("closeScope")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        )}

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            add.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SelectField
              label={t("scopeKind")}
              value={targetKind}
              onChange={(next) => {
                setTargetKind(next);
                setTargetId("");
              }}
              options={SCOPE_KINDS.map((value) => ({ value, label: tScopeKind(value) }))}
            />
            <SelectField
              label={t("scopeTarget")}
              value={targetId}
              onChange={setTargetId}
              options={targets}
              placeholder="—"
            />
            <TextField
              label={t("scopeStartsOn")}
              type="date"
              value={startsOn}
              onChange={setStartsOn}
            />
          </div>
          <Button type="submit" variant="outline" disabled={targetId === "" || add.isPending}>
            {t("addScope")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PolicyDetail({ id }: { id: string }) {
  const t = useTranslations("assurances.detail");
  const tRoot = useTranslations("assurances");
  const tKind = useTranslations("assurances.kind");
  const tStatus = useTranslations("assurances.status");
  const tState = useTranslations("assurances.certificateState");
  const tPeriodicity = useTranslations("assurances.periodicity");
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const policy = useQuery({
    queryKey: ["assurances", "policy", id],
    queryFn: () => rpc.assurances.policies.get({ id }),
  });

  const refresh = async (message: string) => {
    setNotice(message);
    await queryClient.invalidateQueries({ queryKey: ["assurances"] });
  };

  if (policy.isError) return <ErrorBox error={errorPayload(policy.error)} />;
  if (!policy.data) return <Skeleton className="h-64 w-full" />;
  const data = policy.data;

  return (
    <div className="space-y-6">
      <Link className="text-sm underline underline-offset-2" href="/patrimoine/assurances">
        {tRoot("backToList")}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {data.insurerName} · {data.policyNumber}
            <Badge variant="secondary" data-testid="policy-status">
              {tStatus(data.status)}
            </Badge>
            <Badge
              variant={certificateVariant(data.certificateState)}
              data-testid="policy-certificate"
            >
              {tState(data.certificateState)}
            </Badge>
          </CardTitle>
          <CardDescription>{tKind(data.kind)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t("legalEntity")}</dt>
            <dd>{data.legalEntityName ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("insuredPerson")}</dt>
            <dd>{data.insuredPersonName ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("startsOn")}</dt>
            <dd>
              <DateValue value={data.startsOn} />
            </dd>
            <dt className="text-muted-foreground">{t("endsOn")}</dt>
            <dd>
              <DateValue value={data.endsOn} />
            </dd>
            <dt className="text-muted-foreground">{t("premium")}</dt>
            <dd>
              <Money amount={data.premiumAmount} currency={data.currency} />{" "}
              {data.premiumPeriodicity ? `(${tPeriodicity(data.premiumPeriodicity)})` : null}
            </dd>
            <dt className="text-muted-foreground">{t("deductible")}</dt>
            <dd>
              <Money amount={data.deductibleAmount} currency={data.currency} />
            </dd>
            <dt className="text-muted-foreground">{t("cover")}</dt>
            <dd>{data.guaranteesSummary ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("exclusions")}</dt>
            <dd>{data.exclusionsSummary ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("certificateCheckedAt")}</dt>
            <dd>
              {data.lastCertificateDocumentId ? (
                <DateValue value={data.lastCertificateCheckedAt} withTime />
              ) : (
                t("certificateMissing")
              )}
            </dd>
          </dl>
          {notice ? (
            <p role="status" className="text-sm" data-testid="policy-notice">
              {notice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("deadlines")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.deadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDeadline")}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="policy-deadlines">
              {data.deadlines.map((deadline) => (
                <li key={deadline.id} className="flex flex-wrap items-center gap-2">
                  <DateValue value={deadline.dueOn} />
                  <span>{deadline.title}</span>
                  <Badge variant="outline">{deadline.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ScopesCard
        policy={data}
        onChanged={(change) =>
          void refresh(change === "added" ? t("scopeAdded") : t("scopeClosed"))
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("documents")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentPanel object={{ kind: "insurance_policy", id: data.id }} />
        </CardContent>
      </Card>

      <EditForm policy={data} onSaved={() => void refresh(t("saved"))} />
    </div>
  );
}
