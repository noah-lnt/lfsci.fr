"use client";

import { Menu, MessagesSquare, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { authClient } from "@/lib/auth-client";
import { SidebarNav } from "./sidebar";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return (letters.join("") || "?").toUpperCase();
}

export type HeaderUser = { name: string; email: string };

type Props = { user: HeaderUser; showAdmin: boolean; assistant?: React.ReactNode };

export function Header({ user, showAdmin, assistant }: Props) {
  const t = useTranslations("common");
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t("openMenu")}
          onClick={() => setMobileOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 p-0 sm:max-w-72">
            <SheetHeader className="h-16 justify-center border-b px-4">
              <SheetTitle>lfsci</SheetTitle>
              <SheetDescription className="sr-only">Navigation principale</SheetDescription>
            </SheetHeader>
            <SidebarNav
              collapsed={false}
              showAdmin={showAdmin}
              onNavigate={() => setMobileOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t("assistant")}
          onClick={() => setAssistantOpen(true)}
        >
          <MessagesSquare aria-hidden="true" />
          <span className="hidden sm:inline">{t("assistant")}</span>
        </Button>
        <Sheet open={assistantOpen} onOpenChange={setAssistantOpen}>
          <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t("assistant")}</SheetTitle>
              <SheetDescription>{t("assistantDescription")}</SheetDescription>
            </SheetHeader>
            {assistant}
          </SheetContent>
        </Sheet>

        <Button
          variant="ghost"
          size="icon"
          aria-label={t("theme")}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="hidden dark:block" aria-hidden="true" />
          <Moon className="block dark:hidden" aria-hidden="true" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" aria-label={t("account")}>
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-xs text-primary-foreground">
                    {initials(user.name || user.email)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <span className="block truncate font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await authClient.signOut();
                router.push("/connexion");
                router.refresh();
              }}
            >
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
