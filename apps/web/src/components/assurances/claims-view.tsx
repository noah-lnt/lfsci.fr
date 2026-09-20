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
import { errorPayload, rpc } from "@/lib/rpc";

export const CLAIM_STATUSES = [
  "draft",
  "declared",
  "open",
  "expertise",
  "settled",
  "refused",
  "closed",
  "litigation",
] as const;

function ClaimsTable() {
  const t = useTranslations("sinistres");
  const tStatus = useTranslations("sinistres.status");
  const [status, setStatus] = useState("");

  const claims = useQuery({
    queryKey: ["sinistres", "list", status],
    queryFn: () =>
      rpc.assurances.claims.list({
        limit: 50,
        ...(status ? { status: status as "open" } : {}),
      }),
  });

  if (claims.isError) return <ErrorBox error={errorPayload(claims.error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-[14rem]">
          <SelectField
            label={t("filterStatus")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t("all") },
              ...CLAIM_STATUSES.map((value) => ({ value, label: tStatus(value) })),
            ]}
            placeholder={t("all")}
          />
        </div>
      </CardHeader>
      <CardContent>
        {claims.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {claims.data && claims.data.items.length === 0 ? (
          <EmptyState title={t("title")}>{t("empty")}</EmptyState>
        ) : null}
        {claims.data && claims.data.items.length > 0 ? (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.reference")}</TableHead>
                  <TableHead scope="col">{t("columns.occurredOn")}</TableHead>
                  <TableHead scope="col">{t("columns.policy")}</TableHead>
                  <TableHead scope="col">{t("columns.unit")}</TableHead>
                  <TableHead scope="col">{t("columns.cost")}</TableHead>
                  <TableHead scope="col">{t("columns.indemnities")}</TableHead>
                  <TableHead scope="col">{t("columns.remaining")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.data.items.map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell>
                      <Link
                        className="underline underline-offset-2"
                        href={`/travaux/sinistres/${claim.id}`}
                      >
                        {claim.reference ?? claim.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <DateValue value={claim.occurredOn} />
                    </TableCell>
                    <TableCell>{claim.policyLabel ?? "—"}</TableCell>
                    <TableCell>{claim.unitLabel ?? "—"}</TableCell>
                    <TableCell>
                      <Money amount={claim.balance.grossCost} currency={claim.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={claim.balance.grossIndemnities} currency={claim.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={claim.balance.remainingCost} currency={claim.currency} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tStatus(claim.status)}</Badge>
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

function DeclareClaimForm() {
  const t = useTranslations("sinistres.form");
  const router = useRouter();
  const queryClient = useQueryClient();

  const [reference, setReference] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [declaredOn, setDeclaredOn] = useState("");
  const [deadlineOn, setDeadlineOn] = useState("");
  const [facts, setFacts] = useState("");
  const [allegedLiability, setAllegedLiability] = useState("");
  const [estimatedDamage, setEstimatedDamage] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["assurances", "lookups"],
    queryFn: () => rpc.assurances.lookups({}),
  });
  const policyOptions: Option[] = [
    { value: "", label: "—" },
    ...(lookups.data?.policies ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
  ];
  const unitOptions: Option[] = [
    { value: "", label: "—" },
    ...(lookups.data?.units ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
  ];

  const create = useMutation({
    mutationFn: () =>
      rpc.assurances.claims.create({
        ...(reference ? { reference } : {}),
        ...(policyId ? { policyId } : {}),
        ...(unitId ? { unitId } : {}),
        ...(occurredOn ? { occurredOn } : {}),
        ...(declaredOn ? { declaredOn } : {}),
        ...(deadlineOn ? { deadlineOn } : {}),
        ...(facts ? { facts } : {}),
        ...(allegedLiability ? { allegedLiability } : {}),
        ...(estimatedDamage
          ? { estimatedDamage: Number(estimatedDamage.replace(",", ".")).toFixed(2) }
          : {}),
      }),
    onSuccess: async (claim) => {
      await queryClient.invalidateQueries({ queryKey: ["sinistres"] });
      router.push(`/travaux/sinistres/${claim.id}`);
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("createTitle")}</CardTitle>
        <CardDescription>{t("liabilityNote")}</CardDescription>
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
            <TextField label={t("reference")} value={reference} onChange={setReference} />
            <SelectField
              label={t("policy")}
              value={policyId}
              onChange={setPolicyId}
              options={policyOptions}
              placeholder="—"
            />
            <SelectField
              label={t("unit")}
              value={unitId}
              onChange={setUnitId}
              options={unitOptions}
              placeholder="—"
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
            <TextField
              label={t("estimatedDamage")}
              value={estimatedDamage}
              inputMode="decimal"
              onChange={setEstimatedDamage}
            />
          </div>
          <TextAreaField label={t("facts")} value={facts} onChange={setFacts} />
          <TextAreaField
            label={t("allegedLiability")}
            value={allegedLiability}
            onChange={setAllegedLiability}
          />
          <Button type="submit" disabled={facts === "" || create.isPending}>
            {create.isPending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function ClaimsView() {
  return (
    <div className="space-y-6">
      <ClaimsTable />
      <DeclareClaimForm />
    </div>
  );
}
