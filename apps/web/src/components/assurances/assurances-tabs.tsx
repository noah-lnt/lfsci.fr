"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  { href: "/patrimoine/assurances", key: "policies" },
  { href: "/patrimoine/assurances/attestations", key: "attestations" },
] as const;

export function AssurancesTabs() {
  const t = useTranslations("assurances");
  const tAttestations = useTranslations("assurances.attestations");
  const pathname = usePathname();
  const label = (key: string) => (key === "policies" ? t("title") : tAttestations("tab"));

  return (
    <nav aria-label={t("title")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/patrimoine/assurances"
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
                {label(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
