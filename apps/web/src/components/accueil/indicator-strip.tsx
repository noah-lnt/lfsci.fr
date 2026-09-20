"use client";

import { useTranslations } from "next-intl";
import { DateValue } from "@/components/ui/date";
import { EMPTY, Money } from "@/components/ui/money";
import type { AmountIndicator, SituationResult } from "@/lib/contracts/accueil";

type Props = { indicators: SituationResult["indicators"] };

function Tile({
  label,
  children,
  asOf,
}: {
  label: string;
  children: React.ReactNode;
  asOf: string | null;
}) {
  const t = useTranslations("accueil.indicators");
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-lg font-medium">
        {children}
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {asOf ? (
            <>
              {t("asOf", { date: "" })}
              <DateValue value={asOf} />
            </>
          ) : (
            t("unknown")
          )}
        </span>
      </dd>
    </div>
  );
}

function AmountTile({ label, indicator }: { label: string; indicator: AmountIndicator }) {
  return (
    <Tile label={label} asOf={indicator.asOf}>
      <Money amount={indicator.amount} currency={indicator.currency} />
    </Tile>
  );
}

/** Absent data renders `—`; a zero would be a claim about the world (ux.md). */
export function IndicatorStrip({ indicators }: Props) {
  const t = useTranslations("accueil.indicators");

  return (
    <section aria-label={t("title")}>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("title")}</h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile label={t("occupancy")} asOf={indicators.occupancy?.asOf ?? null}>
          {indicators.occupancy ? (
            <span className="num">
              {t("occupancyValue", {
                occupied: indicators.occupancy.occupiedUnits,
                total: indicators.occupancy.totalUnits,
              })}
            </span>
          ) : (
            <span className="num text-muted-foreground">{EMPTY}</span>
          )}
        </Tile>
        <AmountTile label={t("collectedThisMonth")} indicator={indicators.collectedThisMonth} />
        <AmountTile label={t("cash")} indicator={indicators.cash} />
        <AmountTile label={t("debt")} indicator={indicators.debt} />
        <AmountTile label={t("partnerAccounts")} indicator={indicators.partnerAccounts} />
        <AmountTile label={t("netBookValue")} indicator={indicators.netBookValue} />
      </dl>
    </section>
  );
}
