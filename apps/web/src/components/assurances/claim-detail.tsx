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
import type { ClaimDetail as ClaimDetailData } from "@/lib/contracts/assurances";
import { errorPayload, rpc } from "@/lib/rpc";
import { CLAIM_STATUSES } from "./claims-view";

function BalanceCard({ claim }: { claim: ClaimDetailData }) {
  const t = useTranslations("sinistres.balance");
  const balance = claim.balance;
  const entries = [
    { key: "grossCost", value: balance.grossCost },
    { key: "grossIndemnities", value: balance.grossIndemnities },
    { key: "deductible", value: balance.deductible },
    { key: "remaining", value: balance.remainingCost },
    { key: "expected", value: balance.expected },
    { key: "stillExpected", value: balance.stillExpected },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("note")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
          {entries.map((entry) => (
            <div key={entry.key} className="contents">
              <dt className="text-muted-foreground">{t(entry.key)}</dt>
              <dd data-testid={`claim-${entry.key}`}>
                <Money amount={entry.value} currency={claim.currency} />
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ExpensesCard({ claim }: { claim: ClaimDetailData }) {
  const t = useTranslations("sinistres.expenses");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {claim.expenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ScrollRegion label={t("title")}>
            <Table data-testid="claim-expenses">
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.supplier")}</TableHead>
                  <TableHead scope="col">{t("columns.issuedOn")}</TableHead>
                  <TableHead scope="col">{t("columns.intervention")}</TableHead>
                  <TableHead scope="col">{t("columns.amount")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claim.expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>{expense.supplierName ?? "—"}</TableCell>
                    <TableCell>
                      <DateValue value={expense.issuedOn} />
                    </TableCell>
                    <TableCell>{expense.interventionTitle}</TableCell>
                    <TableCell>
                      <Money amount={expense.totalInclTax} currency={expense.currency} />
                    </TableCell>
                    <TableCell>{expense.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        )}
      </CardContent>
    </Card>
  );
}

function InterventionsCard({
  claim,
  onChanged,
}: {
  claim: ClaimDetailData;
  onChanged: (change: "linked" | "unlinked") => void;
}) {
  const t = useTranslations("sinistres.interventions");
  const [interventionId, setInterventionId] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["assurances", "lookups"],
    queryFn: () => rpc.assurances.lookups({}),
  });
  const free = (lookups.data?.interventions ?? []).filter((entry) => entry.claimId === null);
  const options: Option[] = [
    { value: "", label: "—" },
    ...free.map((entry) => ({ value: entry.id, label: entry.label })),
  ];

  const link = useMutation({
    mutationFn: (input: { id: string; version: number; attached: boolean }) =>
      rpc.assurances.claims.linkIntervention({
        claimId: claim.id,
        interventionId: input.id,
        expectedVersion: input.version,
        attached: input.attached,
      }),
    onSuccess: (_result, input) => {
      setInterventionId("");
      onChanged(input.attached ? "linked" : "unlinked");
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("hint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}
        {claim.interventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-2 text-sm" data-testid="claim-interventions">
            {claim.interventions.map((intervention) => (
              <li key={intervention.id} className="flex flex-wrap items-center gap-2">
                <Link
                  className="underline underline-offset-2"
                  href={`/travaux/interventions/${intervention.id}`}
                >
                  {intervention.title}
                </Link>
                <Badge variant="outline">{intervention.status}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={link.isPending}
                  onClick={() => {
                    setError(null);
                    link.mutate({
                      id: intervention.id,
                      version: intervention.version,
                      attached: false,
                    });
                  }}
                >
                  {t("detach")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <SelectField
            label={t("pick")}
            value={interventionId}
            onChange={setInterventionId}
            options={options}
            placeholder="—"
          />
          <Button
            variant="outline"
            disabled={interventionId === "" || link.isPending}
            onClick={() => {
              setError(null);
              const picked = free.find((entry) => entry.id === interventionId);
              if (picked) link.mutate({ id: picked.id, version: picked.version, attached: true });
            }}
          >
            {link.isPending ? t("attaching") : t("attach")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function IndemnitiesCard({ claim }: { claim: ClaimDetailData }) {
  const t = useTranslations("sinistres.indemnities");
  const tKind = useTranslations("sinistres.indemnities.kind");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("readOnly")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {claim.indemnities.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="claim-no-indemnity">
            {t("empty")}
          </p>
        ) : (
          <ScrollRegion label={t("title")}>
            <Table data-testid="claim-indemnities">
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.receivedOn")}</TableHead>
                  <TableHead scope="col">{t("columns.kind")}</TableHead>
                  <TableHead scope="col">{t("columns.amount")}</TableHead>
                  <TableHead scope="col">{t("columns.payment")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claim.indemnities.map((indemnity) => (
                  <TableRow key={indemnity.id}>
                    <TableCell>
                      <DateValue value={indemnity.receivedOn} />
                    </TableCell>
                    <TableCell>{tKind(indemnity.kind)}</TableCell>
                    <TableCell>
                      <Money amount={indemnity.amount} currency={indemnity.currency} />
                    </TableCell>
                    <TableCell>{indemnity.paymentReference ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        )}
        <Button variant="outline" disabled aria-describedby="claim-indemnity-readonly">
          {t("readOnlyTitle")}
        </Button>
        <p id="claim-indemnity-readonly" className="text-xs text-muted-foreground">
          {t("readOnly")}
        </p>
      </CardContent>
    </Card>
  );
}

function EditClaimForm({ claim, onSaved }: { claim: ClaimDetailData; onSaved: () => void }) {
  const t = useTranslations("sinistres.form");
  const tStatus = useTranslations("sinistres.status");

  const [reference, setReference] = useState(claim.reference ?? "");
  const [insurerClaimNumber, setInsurerClaimNumber] = useState(claim.insurerClaimNumber ?? "");
  const [occurredOn, setOccurredOn] = useState(claim.occurredOn ?? "");
  const [declaredOn, setDeclaredOn] = useState(claim.declaredOn ?? "");
  const [deadlineOn, setDeadlineOn] = useState(claim.deadlineOn ?? "");
  const [facts, setFacts] = useState(claim.facts ?? "");
  const [alleged, setAlleged] = useState(claim.allegedLiability ?? "");
  const [acknowledged, setAcknowledged] = useState(claim.acknowledgedLiability ?? "");
  const [expertName, setExpertName] = useState(claim.expertName ?? "");
  const [expertVisitOn, setExpertVisitOn] = useState(claim.expertVisitOn ?? "");
  const [estimatedDamage, setEstimatedDamage] = useState(claim.estimatedDamage ?? "");
  const [indemnityExpected, setIndemnityExpected] = useState(claim.indemnityExpected ?? "");
  const [deductibleApplied, setDeductibleApplied] = useState(claim.deductibleApplied ?? "");
  const [status, setStatus] = useState(claim.status as string);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const decimalOrNull = (value: string) =>
    value === "" ? null : Number(value.replace(",", ".")).toFixed(2);

  const save = useMutation({
    mutationFn: () =>
      rpc.assurances.claims.update({
        id: claim.id,
        expectedVersion: claim.version,
        reference: reference === "" ? null : reference,
        insurerClaimNumber: insurerClaimNumber === "" ? null : insurerClaimNumber,
        occurredOn: occurredOn === "" ? null : occurredOn,
        declaredOn: declaredOn === "" ? null : declaredOn,
        deadlineOn: deadlineOn === "" ? null : deadlineOn,
        facts: facts === "" ? null : facts,
        allegedLiability: alleged === "" ? null : alleged,
        acknowledgedLiability: acknowledged === "" ? null : acknowledged,
        expertName: expertName === "" ? null : expertName,
        expertVisitOn: expertVisitOn === "" ? null : expertVisitOn,
        estimatedDamage: decimalOrNull(estimatedDamage),
        indemnityExpected: decimalOrNull(indemnityExpected),
        deductibleApplied: decimalOrNull(deductibleApplied),
        status: status as "open",
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("editTitle")}</CardTitle>
        <CardDescription>{t("liabilityNote")}</CardDescription>
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
            <TextField label={t("reference")} value={reference} onChange={setReference} />
            <TextField
              label={t("insurerClaimNumber")}
              value={insurerClaimNumber}
              onChange={setInsurerClaimNumber}
            />
            <SelectField
              label={t("status")}
              value={status}
              onChange={setStatus}
              options={CLAIM_STATUSES.map((value) => ({ value, label: tStatus(value) }))}
            />
            <TextField
              label={t("occurredOn")}
              type="date"
              value={occurredOn}
              onChange={setOccurredOn}
            />
            <TextField
              label={t("declaredOn")}
              type="date"
              value={declaredOn}
              onChange={setDeclaredOn}
            />
            <TextField
              label={t("deadlineOn")}
              type="date"
              value={deadlineOn}
              onChange={setDeadlineOn}
            />
            <TextField label={t("expertName")} value={expertName} onChange={setExpertName} />
            <TextField
              label={t("expertVisitOn")}
              type="date"
              value={expertVisitOn}
              onChange={setExpertVisitOn}
            />
            <TextField
              label={t("estimatedDamage")}
              value={estimatedDamage}
              inputMode="decimal"
              onChange={setEstimatedDamage}
            />
            <TextField
              label={t("indemnityExpected")}
              value={indemnityExpected}
              inputMode="decimal"
              onChange={setIndemnityExpected}
            />
            <TextField
              label={t("deductibleApplied")}
              value={deductibleApplied}
              inputMode="decimal"
              onChange={setDeductibleApplied}
            />
          </div>
          <TextAreaField label={t("facts")} value={facts} onChange={setFacts} />
          <TextAreaField label={t("allegedLiability")} value={alleged} onChange={setAlleged} />
          <TextAreaField
            label={t("acknowledgedLiability")}
            value={acknowledged}
            onChange={setAcknowledged}
          />
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t("submitting") : t("save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function ClaimDetail({ id }: { id: string }) {
  const t = useTranslations("sinistres");
  const tForm = useTranslations("sinistres.form");
  const tStatus = useTranslations("sinistres.status");
  const tInterventions = useTranslations("sinistres.interventions");
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const claim = useQuery({
    queryKey: ["sinistres", "detail", id],
    queryFn: () => rpc.assurances.claims.get({ id }),
  });

  const refresh = async (message: string) => {
    setNotice(message);
    await queryClient.invalidateQueries({ queryKey: ["sinistres"] });
    await queryClient.invalidateQueries({ queryKey: ["assurances"] });
  };

  if (claim.isError) return <ErrorBox error={errorPayload(claim.error)} />;
  if (!claim.data) return <Skeleton className="h-64 w-full" />;
  const data = claim.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {data.reference ?? data.id.slice(0, 8)}
            <Badge variant="secondary" data-testid="claim-status">
              {tStatus(data.status)}
            </Badge>
          </CardTitle>
          <CardDescription>{data.policyLabel ?? t("columns.policy")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{tForm("occurredOn")}</dt>
            <dd>
              <DateValue value={data.occurredOn} />
            </dd>
            <dt className="text-muted-foreground">{tForm("declaredOn")}</dt>
            <dd>
              <DateValue value={data.declaredOn} />
            </dd>
            <dt className="text-muted-foreground">{tForm("unit")}</dt>
            <dd>{data.unitLabel ?? "—"}</dd>
            <dt className="text-muted-foreground">{tForm("facts")}</dt>
            <dd>{data.facts ?? "—"}</dd>
            <dt className="text-muted-foreground">{tForm("allegedLiability")}</dt>
            <dd data-testid="claim-alleged">{data.allegedLiability ?? "—"}</dd>
            <dt className="text-muted-foreground">{tForm("acknowledgedLiability")}</dt>
            <dd data-testid="claim-acknowledged">{data.acknowledgedLiability ?? "—"}</dd>
            <dt className="text-muted-foreground">{tForm("deadlineOn")}</dt>
            <dd>
              <DateValue value={data.deadlineOn} />
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">{tForm("liabilityNote")}</p>
          {notice ? (
            <p role="status" className="text-sm" data-testid="claim-notice">
              {notice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <BalanceCard claim={data} />
      <ExpensesCard claim={data} />
      <InterventionsCard
        claim={data}
        onChanged={(change) =>
          void refresh(change === "linked" ? tInterventions("linked") : tInterventions("unlinked"))
        }
      />
      <IndemnitiesCard claim={data} />

      <Card>
        <CardHeader>
          <CardTitle>{t("documents")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentPanel object={{ kind: "claim", id: data.id }} />
        </CardContent>
      </Card>

      <EditClaimForm claim={data} onSaved={() => void refresh(tForm("saved"))} />
    </div>
  );
}
