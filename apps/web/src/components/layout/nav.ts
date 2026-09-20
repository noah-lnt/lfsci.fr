import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Building2,
  CalendarClock,
  FileText,
  Home,
  Inbox,
  KeyRound,
  Terminal,
  Wrench,
} from "lucide-react";

export type NavItem = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  ownerAdminOnly?: boolean;
};

/** Spec UX-02. Ops is reserved to owner_admin (tech pack §10.1). */
export const mainNav: NavItem[] = [
  { href: "/", labelKey: "home", icon: Home },
  { href: "/patrimoine", labelKey: "patrimoine", icon: Building2 },
  { href: "/locations", labelKey: "locations", icon: KeyRound },
  { href: "/finance", labelKey: "finance", icon: Banknote },
  { href: "/travaux", labelKey: "travaux", icon: Wrench },
  { href: "/inbox", labelKey: "inbox", icon: Inbox },
  { href: "/echeancier", labelKey: "echeancier", icon: CalendarClock },
  { href: "/documents", labelKey: "documents", icon: FileText },
];

export const adminNav: NavItem[] = [
  { href: "/admin/ops", labelKey: "ops", icon: Terminal, ownerAdminOnly: true },
];
