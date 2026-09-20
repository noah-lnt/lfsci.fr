"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Money } from "@/components/ui/money";
import { errorPayload, rpc } from "@/lib/rpc";
import { DefinitionList, SectionTitle } from "./ui";

const BLOCKED = [
  "missing_clause",
  "missing_index",
  "quarter_mismatch",
  "dpe_frozen",
  "not_due_yet",
] as const;

function blockedLabel(reason: string): string | null {
  return (BLOCKED as readonly string[]).includes(reason) ? reason : null;
}

export function RevisionTab({ leaseId, leaseVersion }: { leaseId: string; leaseVersion: number }) {
  const t = useTranslations("locations");
  const client = useQueryClient();

  const proposal = useQuery({
    queryKey: ["locations", "revision", leaseId],
    queryFn: () => rpc.locations.revisions.propose({ leaseId }),
  });

  const prepare = useMutation({
    mutationFn: () => rpc.locations.revisions.apply({ leaseId, expectedVersion: leaseVersion }),
    onSuccess: async () => {
      toast.success(t("revision.prepared"));
      await client.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  const data = proposal.data;
  const reason = data?.blockedReason ? blockedLabel(data.blockedReason) : null;

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("revision.title")}</SectionTitle>

        {data && !data.available ? (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
            data-testid="revision-blocked"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">{t("revision.blockedTitle")}</p>
              <p className="text-muted-foreground">
                {reason ? t(`revision.blocked.${reason}`) : (data.blockedReason ?? "—")}
              </p>
              {data.missing.length > 0 ? (
                <p className="text-muted-foreground">
                  {t("revision.missingFields", { fields: data.missing.join(", ") })}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {data?.available ? (
          <div data-testid="revision-proposal">
            <DefinitionList
              rows={[
                { label: t("revision.currentRent"), value: <Money amount={data.currentRent} /> },
                { label: t("revision.newRent"), value: <Money amount={data.newRent} /> },
                { label: t("revision.increase"), value: <Money amount={data.increase} /> },
                {
                  label: t("revision.baseIndex"),
                  value: data.baseIndex
                    ? `${data.baseIndex.value} (${data.baseIndex.year}-T${data.baseIndex.quarter})`
                    : "—",
                },
                {
                  label: t("revision.newIndex"),
                  value: data.newIndex
                    ? `${data.newIndex.value} (${data.newIndex.year}-T${data.newIndex.quarter})`
                    : "—",
                },
                {
                  label: t("revision.effectiveFrom"),
                  value: <DateValue value={data.effectiveFrom} />,
                },
              ]}
            />
          </div>
        ) : null}

        {data?.prepared ? (
          <p className="text-sm">
            <Badge variant="outline">{t("revision.awaiting")}</Badge>{" "}
            <span className="text-muted-foreground">{t("revision.prepared")}</span>
          </p>
        ) : null}

        {prepare.error ? <ErrorBox error={errorPayload(prepare.error)} /> : null}

        {/* Always actionable: a blocked revision answers with its reason rather
            than leaving a dead control on the screen. */}
        <Button
          onClick={() => prepare.mutate()}
          disabled={prepare.isPending}
          data-testid="revision-prepare"
        >
          <TrendingUp aria-hidden="true" />
          {t("revision.prepare")}
        </Button>
      </section>
    </div>
  );
}
