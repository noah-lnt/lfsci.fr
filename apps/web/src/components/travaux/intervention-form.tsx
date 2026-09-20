"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { type Option, SelectField, TextAreaField, TextField } from "@/components/finance/fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorPayload, rpc } from "@/lib/rpc";

const URGENCIES = ["low", "normal", "high", "critical"] as const;
const PERFORMED_BY = ["owner", "supplier", "tenant", "insurer"] as const;

/** MAI-01: a report is one screen — what, where, how urgent, by whom. */
export function InterventionForm() {
  const t = useTranslations("travaux.interventions.form");
  const tUrgency = useTranslations("travaux.urgency");
  const tPerformed = useTranslations("travaux.performedBy");
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [urgency, setUrgency] = useState("normal");
  const [performedBy, setPerformedBy] = useState("owner");
  const [unitId, setUnitId] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["travaux", "lookups"],
    queryFn: () => rpc.travaux.lookups({}),
  });
  const unitOptions: Option[] = [
    { value: "", label: "—" },
    ...(lookups.data?.units ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
  ];

  const create = useMutation({
    mutationFn: () =>
      rpc.travaux.interventions.create({
        title,
        ...(description ? { description } : {}),
        urgency: urgency as "normal",
        performedBy: performedBy as "owner",
        ...(unitId ? { unitId } : {}),
        ...(scheduledOn ? { scheduledOn } : {}),
      }),
    onSuccess: (intervention) => router.push(`/travaux/interventions/${intervention.id}`),
    onError: (cause) => setError(errorPayload(cause)),
  });

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
        </CardHeader>
        <CardContent className="space-y-4">
          <TextField label={t("label")} value={title} onChange={setTitle} required />
          <TextAreaField label={t("description")} value={description} onChange={setDescription} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t("urgency")}
              value={urgency}
              onChange={setUrgency}
              options={URGENCIES.map((value) => ({ value, label: tUrgency(value) }))}
            />
            <SelectField
              label={t("performedBy")}
              value={performedBy}
              onChange={setPerformedBy}
              options={PERFORMED_BY.map((value) => ({ value, label: tPerformed(value) }))}
            />
            <SelectField
              label={t("unit")}
              value={unitId}
              onChange={setUnitId}
              options={unitOptions}
              placeholder="—"
            />
            <TextField
              label={t("scheduledOn")}
              type="date"
              value={scheduledOn}
              onChange={setScheduledOn}
            />
          </div>
        </CardContent>
      </Card>
      <Button type="submit" size="lg" disabled={title === "" || create.isPending}>
        {create.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
