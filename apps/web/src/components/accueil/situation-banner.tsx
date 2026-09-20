"use client";

import type { api } from "@lfsci/contracts";
import { CircleAlert, CircleCheck, CircleHelp } from "lucide-react";
import { useTranslations } from "next-intl";
import { DateValue } from "@/components/ui/date";

type Props = { banner: api.actionRequired.SituationBanner };

const ICON = {
  complete: CircleCheck,
  partial: CircleAlert,
  sources_unavailable: CircleHelp,
} as const;

const TONE = {
  complete: "border-emerald-600/40 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400",
  partial: "border-amber-600/40 bg-amber-600/5 text-amber-700 dark:text-amber-400",
  sources_unavailable: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
} as const;

/** UX-01: colour never carries the meaning alone — icon plus label, always. */
export function SituationBanner({ banner }: Props) {
  const t = useTranslations("accueil.banner");
  const Icon = ICON[banner.controls];

  return (
    <section
      aria-label={t("title")}
      data-testid="situation-banner"
      data-controls={banner.controls}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border p-4 text-sm ${TONE[banner.controls]}`}
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {t(banner.controls)}
      </span>
      <span className="text-muted-foreground">
        {t("lastRun")} : <DateValue value={banner.lastRunAt} withTime />
      </span>
      {banner.failed.length > 0 ? (
        <span className="text-muted-foreground">
          {t("failed")} : {banner.failed.join(", ")}
        </span>
      ) : null}
    </section>
  );
}
