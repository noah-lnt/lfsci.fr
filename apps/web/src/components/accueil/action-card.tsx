"use client";

import { ArrowRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import type { ActionCard as Card } from "@/lib/contracts/accueil";

const ICON = { critical: CircleAlert, warning: TriangleAlert, info: Info } as const;

/** UX-01: why it is here, what it blocks, the proposed action, the expected effect. */
export function ActionCardItem({ card }: { card: Card }) {
  const t = useTranslations("accueil");
  const Icon = ICON[card.severity];

  return (
    <li
      data-testid="action-card"
      data-kind={card.kind}
      className="rounded-xl border bg-card p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Icon
          className={
            card.severity === "critical"
              ? "size-4 text-destructive"
              : card.severity === "warning"
                ? "size-4 text-amber-600"
                : "size-4 text-muted-foreground"
          }
          aria-hidden="true"
        />
        <h3 className="text-sm font-medium">{t(`kind.${card.kind}`)}</h3>
        <Badge variant="outline">{t(`severity.${card.severity}`)}</Badge>
        {card.blocking ? <Badge variant="destructive">{t("blocking")}</Badge> : null}
        {card.groupedCount ? (
          <Badge variant="secondary">{t("grouped", { count: card.groupedCount })}</Badge>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          <DateValue value={card.occurredAt} />
        </span>
      </div>

      <p className="mt-2 text-sm">{card.why}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("effect")} : {card.expectedEffect}
      </p>

      <div className="mt-3">
        <LinkButton href={card.proposedAction.href} variant="outline" size="sm">
          {card.proposedAction.label}
          <ArrowRight aria-hidden="true" />
        </LinkButton>
      </div>
    </li>
  );
}
