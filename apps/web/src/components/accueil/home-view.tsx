"use client";

import { useQuery } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useTranslations } from "next-intl";
import { ErrorBox } from "@/components/feedback/error-box";
import { LinkButton } from "@/components/ui/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorPayload, rpc } from "@/lib/rpc";
import { ActionCardItem } from "./action-card";
import { IndicatorStrip } from "./indicator-strip";
import { SituationBanner } from "./situation-banner";

export function HomeView() {
  const t = useTranslations("accueil");
  const common = useTranslations("common");

  const situation = useQuery({
    queryKey: ["accueil", "situation"],
    queryFn: () => rpc.accueil.situation(),
  });
  const cards = useQuery({
    queryKey: ["accueil", "cards"],
    queryFn: () => rpc.accueil.actionRequired({ limit: 20 }),
  });

  const failed = situation.error ?? cards.error;
  const items = cards.data?.cards ?? [];
  const controlsComplete = situation.data?.banner.controls === "complete";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* ux.md: the capture stays in the page flow, never floating; the assistant lives in the header. */}
        <LinkButton href="/inbox?capture=1">
          <Camera aria-hidden="true" />
          {common("capture")}
        </LinkButton>
      </div>

      {failed ? <ErrorBox error={errorPayload(failed)} /> : null}

      {situation.data ? (
        <SituationBanner banner={situation.data.banner} model={situation.data.model} />
      ) : (
        <Skeleton className="h-16 w-full rounded-xl" />
      )}

      <section aria-label={t("cardsTitle")}>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("cardsTitle")}</h2>
        {cards.isPending ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((card) => (
              <ActionCardItem key={card.id} card={card} />
            ))}
          </ul>
        ) : (
          <div
            className="rounded-xl border border-dashed bg-card p-8 text-center"
            data-testid="accueil-empty"
          >
            {/* UX-06: "rien à faire" is only sayable when the controls are complete. */}
            <h3 className="text-sm font-medium">
              {controlsComplete ? t("empty") : t("notEmptyYet")}
            </h3>
            {controlsComplete ? (
              <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
                {t("emptyHint")}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {situation.data ? <IndicatorStrip indicators={situation.data.indicators} /> : null}
    </div>
  );
}
