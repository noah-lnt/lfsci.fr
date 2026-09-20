"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/finance/charges", key: "runs" },
  { href: "/finance/charges/cles", key: "keys" },
] as const;

export function ChargesTabs() {
  const t = useTranslations("charges");
  const pathname = usePathname();

  return (
    <nav aria-label={t("title")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/finance/charges"
              ? pathname === tab.href || /^\/finance\/charges\/[0-9a-f-]{36}$/.test(pathname)
              : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
