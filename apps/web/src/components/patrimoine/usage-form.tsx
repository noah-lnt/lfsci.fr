"use client";

import type { ErrorPayload, UnitUsagePeriod } from "@lfsci/contracts";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateValue } from "@/components/ui/date";
import { SetUnitUsageInput } from "@/lib/contracts/patrimoine";
import { errorPayload, rpc } from "@/lib/rpc";
import { FormGrid, SelectField, TextField, trimmed } from "./form-kit";

type Props = { unitId: string; periods: UnitUsagePeriod[] };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** PAT-01: a dated change that refuses to overlap an existing period. */
export function UsageForm({ unitId, periods }: Props) {
  const t = useTranslations("patrimoine");
  const router = useRouter();
  const [usage, setUsage] = useState("bare_rental");
  const [startsOn, setStartsOn] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: async () => {
      const parsed = SetUnitUsageInput.safeParse({
        unitId,
        usage,
        startsOn,
        ...(trimmed(note) === undefined ? {} : { note: trimmed(note) }),
      });
      if (!parsed.success) {
        setFieldError(parsed.error.issues[0]?.message ?? "Valeur invalide.");
        throw new Error("invalid");
      }
      setFieldError(null);
      return rpc.patrimoine.units.setUsage(parsed.data);
    },
    onSuccess: () => {
      toast.success(t("unit.usageChanged"));
      setError(null);
      router.refresh();
    },
    onError: (cause) => {
      if (cause instanceof Error && cause.message === "invalid") return;
      setError(errorPayload(cause));
    },
  });

  const usages = t.raw("usage") as Record<string, string>;
  const current = periods.find((period) => period.endsOn === null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("unit.usageTitle")}</CardTitle>
        <CardDescription>{t("unit.usageHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm">
          {t("unit.usageCurrent")} :{" "}
          <strong>{current ? (usages[current.usage] ?? current.usage) : "—"}</strong>
        </p>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate();
          }}
        >
          <FormGrid>
            <SelectField
              label={t("unit.usageCurrent")}
              value={usage}
              options={Object.fromEntries(
                Object.entries(usages).filter(([key]) => key !== "unknown"),
              )}
              onChange={setUsage}
            />
            <TextField
              label={t("unit.usageStartsOn")}
              type="date"
              value={startsOn}
              onChange={setStartsOn}
              {...(fieldError ? { errors: [fieldError] } : {})}
            />
            <TextField label={t("unit.usageNote")} value={note} onChange={setNote} />
          </FormGrid>
          <Button type="submit" size="lg" className="h-11 sm:h-9" disabled={change.isPending}>
            {change.isPending ? t("saving") : t("unit.usageSubmit")}
          </Button>
        </form>

        {error ? <ErrorBox error={error} /> : null}

        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            {t("unit.usageHistory")}
          </h3>
          {periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {periods.map((period) => (
                <li key={period.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">{usages[period.usage] ?? period.usage}</span>
                  <span className="text-muted-foreground">
                    <DateValue value={period.startsOn} /> → <DateValue value={period.endsOn} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
