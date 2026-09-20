"use client";

import type { ErrorPayload, Intervention } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { TextAreaField, TextField } from "@/components/finance/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateValue } from "@/components/ui/date";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { errorPayload, rpc } from "@/lib/rpc";

type Status = Intervention["status"];

export function InterventionDetail({ id }: { id: string }) {
  const t = useTranslations("travaux.interventions.detail");
  const tStatus = useTranslations("travaux.status");
  const tUrgency = useTranslations("travaux.urgency");
  const queryClient = useQueryClient();

  const [observedResult, setObservedResult] = useState("");
  const [ownerHours, setOwnerHours] = useState("");
  const [hourlyValue, setHourlyValue] = useState("");
  const [nextCheckOn, setNextCheckOn] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const intervention = useQuery({
    queryKey: ["travaux", "intervention", id],
    queryFn: () => rpc.travaux.interventions.get({ id }),
  });

  const transition = useMutation({
    mutationFn: async (to: Status) => {
      const current = intervention.data;
      if (!current) throw new Error("intervention not loaded");
      return rpc.travaux.interventions.transition({
        id,
        expectedVersion: current.version,
        to,
        ...(to === "done"
          ? {
              observedResult,
              ownerHours: Number(ownerHours.replace(",", ".")).toFixed(2),
              ...(hourlyValue
                ? { ownerHourlyValue: Number(hourlyValue.replace(",", ".")).toFixed(2) }
                : {}),
              ...(nextCheckOn ? { nextCheckOn } : {}),
            }
          : {}),
      });
    },
    onSuccess: async (result) => {
      setError(null);
      setNotice(result.deadlineId ? t("nextCheckCreated") : t("transitionDone"));
      await queryClient.invalidateQueries({ queryKey: ["travaux", "intervention", id] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  if (intervention.isError) return <ErrorBox error={errorPayload(intervention.error)} />;
  if (!intervention.data) return <Skeleton className="h-64 w-full" />;
  const data = intervention.data;
  const canClose = data.allowedTransitions.includes("done");
  const closeReady = observedResult.trim() !== "" && /^\d+([.,]\d{1,2})?$/.test(ownerHours);

  return (
    <div className="space-y-6">
      {error ? <ErrorBox error={error} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3">
            {data.title}
            <Badge variant="secondary" data-testid="intervention-status">
              {tStatus(data.status)}
            </Badge>
          </CardTitle>
          <CardDescription>{tUrgency(data.urgency)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t("observedResult")}</dt>
            <dd>{data.observedResult ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("ownerHours")}</dt>
            <dd className="num">{data.ownerHours ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("simulatedCost")}</dt>
            <dd>
              <Money amount={data.simulatedOwnerCost} />
            </dd>
            <dt className="text-muted-foreground">{t("nextCheckOn")}</dt>
            <dd>
              <DateValue value={data.nextCheckOn} />
            </dd>
          </dl>
          <p className="text-xs text-muted-foreground">{t("simulatedNote")}</p>

          <div className="flex flex-wrap gap-2">
            {data.allowedTransitions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noTransition")}</p>
            ) : null}
            {data.allowedTransitions
              .filter((to) => to !== "done")
              .map((to) => (
                <Button
                  key={to}
                  variant="outline"
                  disabled={transition.isPending}
                  onClick={() => transition.mutate(to)}
                >
                  {tStatus(to)}
                </Button>
              ))}
          </div>

          {notice ? (
            <p role="status" className="text-sm" data-testid="intervention-notice">
              {notice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("close")}</CardTitle>
          <CardDescription>{t("closeHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextAreaField
            label={t("observedResult")}
            value={observedResult}
            onChange={setObservedResult}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <TextField
              label={t("ownerHours")}
              value={ownerHours}
              inputMode="decimal"
              onChange={setOwnerHours}
            />
            <TextField
              label={t("hourlyValue")}
              value={hourlyValue}
              inputMode="decimal"
              onChange={setHourlyValue}
            />
            <TextField
              label={t("nextCheckOn")}
              type="date"
              value={nextCheckOn}
              onChange={setNextCheckOn}
            />
          </div>
          <Button
            disabled={!canClose || !closeReady || transition.isPending}
            onClick={() => transition.mutate("done")}
          >
            {t("close")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
