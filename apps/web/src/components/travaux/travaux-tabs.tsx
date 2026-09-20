"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/travaux", key: "overview" },
  { href: "/travaux/equipements", key: "equipment" },
  { href: "/travaux/compteurs", key: "meters" },
] as const;

export function TravauxTabs() {
  const t = useTranslations("travaux.tabs");
  const pathname = usePathname();

  return (
    <nav aria-label={t("overview")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/travaux"
              ? pathname === tab.href || pathname.startsWith("/travaux/interventions")
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
