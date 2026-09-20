"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeadlineHorizon, DeadlineRow } from "@/lib/contracts/echeancier";
import { errorPayload, rpc } from "@/lib/rpc";
import { PostponeDialog } from "./postpone-dialog";

const HORIZONS: DeadlineHorizon[] = ["overdue", "d7", "d30", "d90", "d365", "later"];

export function EcheancierView() {
  const t = useTranslations("echeancier");
  const queryClient = useQueryClient();
  const [horizon, setHorizon] = useState<DeadlineHorizon | null>(null);
  const [postponing, setPostponing] = useState<DeadlineRow | null>(null);

  const list = useQuery({
    queryKey: ["echeancier", "list"],
    queryFn: () => rpc.echeancier.list({ includeClosed: false, limit: 200 }),
  });

  const complete = useMutation({
    mutationFn: (row: DeadlineRow) =>
      rpc.echeancier.complete({ id: row.id, expectedVersion: row.version }),
    onSuccess: async () => {
      toast.success(t("completed"));
      await queryClient.invalidateQueries({ queryKey: ["echeancier"] });
    },
  });

  const postpone = useMutation({
    mutationFn: (input: { row: DeadlineRow; newDueOn: string; reason: string }) =>
      rpc.echeancier.postpone({
        id: input.row.id,
        expectedVersion: input.row.version,
        newDueOn: input.newDueOn,
        reason: input.reason,
      }),
    onSuccess: async () => {
      toast.success(t("postponed"));
      setPostponing(null);
      await queryClient.invalidateQueries({ queryKey: ["echeancier"] });
    },
  });

  const counts = list.data?.counts;
  const items = (list.data?.items ?? []).filter((row) => !horizon || row.horizon === horizon);
  const failed = list.error ?? complete.error ?? postpone.error;

  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{t("filters")}</legend>
        {HORIZONS.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={horizon === name ? "default" : "outline"}
            aria-pressed={horizon === name}
            onClick={() => setHorizon(horizon === name ? null : name)}
          >
            {t(`horizon.${name}`)}
            <Badge variant="secondary">{counts?.[name] ?? 0}</Badge>
          </Button>
        ))}
      </fieldset>

      {failed ? <ErrorBox error={errorPayload(failed)} /> : null}

      {list.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border border-dashed bg-card p-8 text-center"
          data-testid="echeancier-empty"
        >
          <h2 className="text-sm font-medium">{t("empty")}</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        HORIZONS.filter((name) => items.some((row) => row.horizon === name)).map((name) => (
          <section key={name} aria-label={t(`horizon.${name}`)}>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              {t(`horizon.${name}`)}
            </h2>
            <ul className="space-y-2">
              {items
                .filter((row) => row.horizon === name)
                .map((row) => (
                  <li
                    key={row.id}
                    id={row.id}
                    data-testid="deadline-row"
                    data-horizon={row.horizon}
                    className="rounded-xl border bg-card p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.title}</span>
                      <Badge variant="outline">{t(`priority.${row.priority}`)}</Badge>
                      <Badge variant="secondary">{t(`status.${row.status}`)}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {t("dueOn")} : <DateValue value={row.dueOn} />
                      </span>
                    </div>
                    {row.originalDueOn ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("originalDueOn")} : <DateValue value={row.originalDueOn} />
                        {row.postponedReason ? ` — ${row.postponedReason}` : ""}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => complete.mutate(row)}
                        disabled={complete.isPending}
                      >
                        {t("complete")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPostponing(row)}>
                        {t("postpone")}
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}

      <PostponeDialog
        open={postponing !== null}
        onOpenChange={(open) => !open && setPostponing(null)}
        pending={postpone.isPending}
        onConfirm={(input) => {
          if (postponing) postpone.mutate({ row: postponing, ...input });
        }}
      />
    </div>
  );
}
