"use client";

import { cn } from "cn";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { adminNav, mainNav, type NavItem } from "./nav";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

type ItemProps = { item: NavItem; collapsed: boolean; onNavigate?: () => void };

function SidebarLink({ item, collapsed, onNavigate }: ItemProps) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
        "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn(collapsed && "sr-only")}>{t(item.labelKey)}</span>
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{t(item.labelKey)}</TooltipContent>
    </Tooltip>
  );
}

type NavProps = { collapsed: boolean; showAdmin: boolean; onNavigate?: () => void };

export function SidebarNav({ collapsed, showAdmin, onNavigate }: NavProps) {
  const t = useTranslations("nav.sections");
  return (
    <nav aria-label={t("main")} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {mainNav.map((item) => (
        <SidebarLink
          key={item.href}
          item={item}
          collapsed={collapsed}
          {...(onNavigate ? { onNavigate } : {})}
        />
      ))}
      {showAdmin ? (
        <>
          <div className="mx-0 my-3 border-t border-sidebar-border" />
          {!collapsed ? (
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("admin")}
            </p>
          ) : null}
          {adminNav.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              {...(onNavigate ? { onNavigate } : {})}
            />
          ))}
        </>
      ) : null}
    </nav>
  );
}

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  showAdmin: boolean;
};

export function Sidebar({ collapsed, onToggle, showAdmin }: SidebarProps) {
  const t = useTranslations("common");
  const app = useTranslations("app");

  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r bg-sidebar transition-[width] duration-300 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          lf
        </span>
        {!collapsed ? (
          <span className="truncate text-sm font-semibold tracking-tight">{app("name")}</span>
        ) : null}
      </div>

      <SidebarNav collapsed={collapsed} showAdmin={showAdmin} />

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
        className="flex h-12 items-center justify-center gap-2 border-t text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        {collapsed ? (
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        ) : (
          <>
            <PanelLeftClose className="size-4" aria-hidden="true" />
            <span>{t("collapseSidebar")}</span>
          </>
        )}
      </button>
    </aside>
  );
}
