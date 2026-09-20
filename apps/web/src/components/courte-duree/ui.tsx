"use client";

import { cn } from "cn";
import {
  Archive,
  Ban,
  CalendarOff,
  CircleCheck,
  CircleDashed,
  CirclePause,
  FileText,
  Info,
  PlaneLanding,
  PlaneTakeoff,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { BookingRow, ListingRow, PayoutRow } from "@/lib/contracts/courte-duree";

const TABS = [
  { href: "/locations/courte-duree", key: "listings" },
  { href: "/locations/courte-duree/reservations", key: "bookings" },
  { href: "/locations/courte-duree/import", key: "import" },
  { href: "/locations/courte-duree/versements", key: "payouts" },
] as const;

export function CourteDureeTabs() {
  const t = useTranslations("courteDuree.sections");
  const pathname = usePathname();

  return (
    <nav aria-label={t("listings")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/locations/courte-duree"
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/** AIR-03: the calendar disclaimer travels with every screen that shows one. */
export function IcalNotice({ children }: { children?: ReactNode }) {
  const t = useTranslations("courteDuree.ical");
  return (
    <div data-testid="ical-notice">
      <Notice title={t("title")}>
        {t("text")} {children}
      </Notice>
    </div>
  );
}

export function ModelNotice() {
  const t = useTranslations("courteDuree.model");
  return (
    <div data-testid="model-notice">
      <Notice title={t("title")}>{t("text")}</Notice>
    </div>
  );
}

const LISTING_ICON = {
  draft: FileText,
  active: CircleCheck,
  paused: CirclePause,
  archived: Archive,
} as const;

/** Colour never carries the meaning alone: every badge holds an icon and a label. */
export function ListingStatusBadge({ status }: { status: ListingRow["status"] }) {
  const t = useTranslations("courteDuree.listings.status");
  const Icon = LISTING_ICON[status];
  return (
    <Badge
      variant={status === "active" ? "default" : "outline"}
      className="gap-1"
      data-testid="listing-status"
    >
      <Icon aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

const BOOKING_ICON = {
  blocked: CalendarOff,
  pending: CircleDashed,
  confirmed: CircleCheck,
  in_stay: PlaneLanding,
  completed: PlaneTakeoff,
  cancelled: Ban,
  disputed: TriangleAlert,
} as const;

export function BookingStatusBadge({ status }: { status: BookingRow["status"] }) {
  const t = useTranslations("courteDuree.bookings.status");
  const Icon = BOOKING_ICON[status];
  return (
    <Badge
      variant={
        status === "confirmed" || status === "completed"
          ? "default"
          : status === "disputed"
            ? "destructive"
            : "outline"
      }
      className="gap-1"
      data-testid="booking-status"
    >
      <Icon aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

const PAYOUT_ICON = {
  imported: CircleDashed,
  matched: CircleCheck,
  variance: TriangleAlert,
  confirmed: CircleCheck,
  rejected: Ban,
} as const;

export function PayoutStatusBadge({ status }: { status: PayoutRow["status"] }) {
  const t = useTranslations("courteDuree.payouts.status");
  const Icon = PAYOUT_ICON[status];
  return (
    <Badge
      variant={
        status === "confirmed" ? "default" : status === "variance" ? "destructive" : "outline"
      }
      className="gap-1"
      data-testid="payout-status"
    >
      <Icon aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

export function FeedFreshness({
  neverPolled,
  stale,
  lastPolledAt,
}: {
  neverPolled: boolean;
  stale: boolean;
  lastPolledAt: string | null;
}) {
  const t = useTranslations("courteDuree.ical");
  const label = neverPolled ? t("never") : stale ? t("stale") : t("fresh");
  return (
    <Badge variant={neverPolled || stale ? "outline" : "default"} className="gap-1">
      <CalendarOff aria-hidden="true" />
      <span>{label}</span>
      {lastPolledAt ? <span className="sr-only">{t("lastPolled")}</span> : null}
    </Badge>
  );
}
