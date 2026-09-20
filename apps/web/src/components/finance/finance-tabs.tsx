"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/finance", key: "overview" },
  { href: "/finance/depenses", key: "expenses" },
  { href: "/finance/credits", key: "loans" },
  { href: "/finance/cca", key: "cca" },
  { href: "/finance/charges", key: "charges" },
  { href: "/finance/actifs", key: "assets" },
  { href: "/finance/banques", key: "banks" },
  { href: "/finance/acquisitions", key: "acquisitions" },
] as const;

export function FinanceTabs() {
  const t = useTranslations("finance.tabs");
  const pathname = usePathname();

  return (
    <nav aria-label={t("overview")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/finance" ? pathname === tab.href : pathname.startsWith(tab.href);
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
