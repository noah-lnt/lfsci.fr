"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { InboxDecision } from "@/lib/contracts/inbox";
import { errorPayload, rpc } from "@/lib/rpc";

type Props = { id: string | null; onDecided: (href: string | null) => void };

export function InboxDetail({ id, onDecided }: Props) {
  const t = useTranslations("inbox");
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");

  const detail = useQuery({
    queryKey: ["inbox", "item", id],
    queryFn: () => rpc.inbox.get({ id: id as string }),
    enabled: id !== null,
  });
  const targets = useQuery({
    queryKey: ["inbox", "targets"],
    queryFn: () => rpc.inbox.targets({ limit: 25 }),
  });

  const decide = useMutation({
    mutationFn: async (decision: InboxDecision) => {
      const item = detail.data;
      if (!item) throw new Error("no item");
      const chosen = targets.data?.items.find(
        (entry) => `${entry.object.kind}:${entry.object.id}` === target,
      );
      return rpc.inbox.decide({
        id: item.id,
        expectedVersion: item.version,
        decision,
        ...(decision === "attach" && chosen ? { attachTo: chosen.object } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
    },
    onSuccess: async (result) => {
      toast.success(t(`status.${result.item.status}`));
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["inbox"] });
      onDecided(result.handoffHref);
    },
  });

  if (!id) {
    return (
      <div className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
        {t("noSelection")}
      </div>
    );
  }
  if (detail.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (detail.error) return <ErrorBox error={errorPayload(detail.error)} />;

  const item = detail.data;
  if (!item) return null;
  const href = `/documents/${item.documentId}`;

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4" data-testid="inbox-detail">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">{t("detailTitle")}</h2>
        <Badge variant="outline">{t(`status.${item.status}`)}</Badge>
      </div>

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">{t("original")}</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm">{item.bodyRaw ?? item.summary ?? "—"}</p>
        {item.documentId ? (
          <LinkButton href={href} className="mt-2" variant="outline" size="sm">
            {t("openDocument")}
          </LinkButton>
        ) : null}
      </section>

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">{t("extracted")}</h3>
        {item.fields.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("noFields")}</p>
        ) : (
          <dl className="mt-1 grid gap-x-4 text-sm sm:grid-cols-[auto_1fr]">
            {item.fields.map((field) => (
              <div key={field.fieldPath} className="contents">
                <dt className="text-muted-foreground">{field.fieldPath}</dt>
                <dd className="num">{field.value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {item.uncertaintyReason ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t("uncertainty")} : {item.uncertaintyReason}
        </p>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-xs font-medium text-muted-foreground">{t("actions")}</h3>

        <div className="space-y-1.5">
          <Label htmlFor="inbox-target">{t("attachHint")}</Label>
          <Select value={target} onValueChange={(value) => setTarget(value ?? "")}>
            <SelectTrigger id="inbox-target" className="w-full">
              <SelectValue placeholder={t("proposed")} />
            </SelectTrigger>
            <SelectContent>
              {(targets.data?.items ?? []).map((entry) => (
                <SelectItem
                  key={`${entry.object.kind}:${entry.object.id}`}
                  value={`${entry.object.kind}:${entry.object.id}`}
                >
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inbox-reason">{t("reason")}</Label>
          <Textarea
            id="inbox-reason"
            rows={2}
            placeholder={t("reasonPlaceholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {decide.error ? <ErrorBox error={errorPayload(decide.error)} /> : null}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => decide.mutate("attach")} disabled={decide.isPending || !target}>
            {t("attach")}
          </Button>
          <Button
            variant="outline"
            onClick={() => decide.mutate("createExpense")}
            disabled={decide.isPending}
          >
            {t("createExpense")}
          </Button>
          <Button
            variant="outline"
            onClick={() => decide.mutate("createIntervention")}
            disabled={decide.isPending}
          >
            {t("createIntervention")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => decide.mutate("quarantine")}
            disabled={decide.isPending}
          >
            {t("quarantine")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => decide.mutate("dismiss")}
            disabled={decide.isPending || reason.trim().length === 0}
          >
            {t("dismiss")}
          </Button>
        </div>
      </section>
    </div>
  );
}
