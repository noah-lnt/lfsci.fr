"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CheckboxField } from "@/components/assurances/fields";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { SelectField, TextField } from "@/components/finance/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateValue } from "@/components/ui/date";
import { Skeleton } from "@/components/ui/skeleton";
import type { AttestationCandidate } from "@/lib/contracts/assurances";
import { errorPayload, rpc } from "@/lib/rpc";

const FIELD_ORDER = [
  "insurer",
  "policyNumber",
  "insuredName",
  "address",
  "validFrom",
  "validTo",
] as const;

function CandidateCard({
  candidate,
  onAttached,
}: {
  candidate: AttestationCandidate;
  onAttached: (notice: string) => void;
}) {
  const t = useTranslations("assurances.attestations");
  const tField = useTranslations("assurances.attestations.fields");
  const tSignal = useTranslations("assurances.attestations.signals");
  const queryClient = useQueryClient();

  const [policyId, setPolicyId] = useState(candidate.proposals[0]?.policyId ?? "");
  const [coverEndsOn, setCoverEndsOn] = useState(candidate.extracted.validTo ?? "");
  const [identity, setIdentity] = useState(false);
  const [property, setProperty] = useState(false);
  const [cover, setCover] = useState(false);
  const [dates, setDates] = useState(false);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const selected = candidate.proposals.find((proposal) => proposal.policyId === policyId);
  const allChecked = identity && property && cover && dates;
  const ready = allChecked && policyId !== "" && candidate.documentId !== null;

  const attach = useMutation({
    mutationFn: () => {
      if (!candidate.documentId) throw new Error("no document on this inbox item");
      return rpc.assurances.attestations.attach({
        inboxItemId: candidate.inboxItemId,
        expectedVersion: candidate.version,
        policyId,
        documentId: candidate.documentId,
        ...(coverEndsOn ? { coverEndsOn } : {}),
        checks: { identity, property, cover, dates },
      });
    },
    onSuccess: async (result) => {
      setError(null);
      // The card leaves the queue once attached, so the confirmation lives above it.
      onAttached(
        result.nextDeadlineOn
          ? `${t("attached")} ${t("nextDeadline", { date: result.nextDeadlineOn })}`
          : t("attached"),
      );
      await queryClient.invalidateQueries({ queryKey: ["assurances"] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card data-testid="attestation-candidate">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {candidate.summary ?? t("title")}
          <Badge variant="outline">
            {t("received")} <DateValue value={candidate.receivedAt} />
          </Badge>
        </CardTitle>
        {candidate.uncertaintyReason ? <CardDescription>{t("uncertain")}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}

        <div>
          <h3 className="text-sm font-medium">{t("extracted")}</h3>
          <dl className="grid gap-x-6 gap-y-1.5 pt-2 text-sm sm:grid-cols-[auto_1fr]">
            {FIELD_ORDER.map((field) => (
              <div key={field} className="contents">
                <dt className="text-muted-foreground">{tField(field)}</dt>
                <dd>{candidate.extracted[field] ?? "—"}</dd>
              </div>
            ))}
            <dt className="text-muted-foreground">{tField("coverage")}</dt>
            <dd>
              {candidate.extracted.coverage.length > 0
                ? candidate.extracted.coverage.join(", ")
                : "—"}
            </dd>
          </dl>
        </div>

        {candidate.proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noProposal")}</p>
        ) : (
          <div className="space-y-2">
            <SelectField
              label={t("proposal")}
              value={policyId}
              onChange={setPolicyId}
              options={candidate.proposals.map((proposal) => ({
                value: proposal.policyId,
                label: proposal.policyLabel,
              }))}
            />
            {selected ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("matchedOn")}</span>
                {selected.matchedOn.map((signal) => (
                  <Badge key={signal} variant="secondary" data-testid="attestation-matched">
                    {tSignal(signal)}
                  </Badge>
                ))}
                {selected.conflicts.length > 0 ? (
                  <>
                    <span className="text-muted-foreground">{t("conflicts")}</span>
                    {selected.conflicts.map((signal) => (
                      <Badge key={signal} variant="destructive" data-testid="attestation-conflict">
                        {tSignal(signal)}
                      </Badge>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
            {selected && !selected.confident ? (
              <p className="text-sm text-muted-foreground">{t("notConfident")}</p>
            ) : null}
          </div>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("checksTitle")}</legend>
          <p className="text-xs text-muted-foreground">{t("checksHint")}</p>
          <CheckboxField label={t("checks.identity")} checked={identity} onChange={setIdentity} />
          <CheckboxField label={t("checks.property")} checked={property} onChange={setProperty} />
          <CheckboxField label={t("checks.cover")} checked={cover} onChange={setCover} />
          <CheckboxField label={t("checks.dates")} checked={dates} onChange={setDates} />
        </fieldset>

        <TextField
          label={t("coverEndsOn")}
          type="date"
          value={coverEndsOn}
          onChange={setCoverEndsOn}
          className="space-y-1.5 sm:max-w-xs"
        />

        {candidate.documentId === null ? (
          <p className="text-sm text-muted-foreground">{t("noDocument")}</p>
        ) : null}

        <Button disabled={!ready || attach.isPending} onClick={() => attach.mutate()}>
          {attach.isPending ? t("attaching") : t("attach")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function AttestationsView() {
  const t = useTranslations("assurances.attestations");
  const [notice, setNotice] = useState<string | null>(null);
  const candidates = useQuery({
    queryKey: ["assurances", "attestations"],
    queryFn: () => rpc.assurances.attestations.list({ limit: 20 }),
  });

  if (candidates.isError) return <ErrorBox error={errorPayload(candidates.error)} />;

  return (
    <div className="space-y-6">
      {notice ? (
        <p
          role="status"
          className="rounded-xl border bg-card p-3 text-sm"
          data-testid="attestation-notice"
        >
          {notice}
        </p>
      ) : null}
      {candidates.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {candidates.data && candidates.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}
      {(candidates.data?.items ?? []).map((candidate) => (
        <CandidateCard key={candidate.inboxItemId} candidate={candidate} onAttached={setNotice} />
      ))}
    </div>
  );
}
