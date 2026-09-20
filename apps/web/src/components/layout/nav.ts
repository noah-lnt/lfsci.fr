import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Building2,
  Calculator,
  CalendarClock,
  CalendarDays,
  FileText,
  HandCoins,
  Home,
  Inbox,
  KeyRound,
  Search,
  ShieldCheck,
  Siren,
  Terminal,
  Umbrella,
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
  { href: "/locations/courte-duree", labelKey: "courteDuree", icon: CalendarDays },
  { href: "/finance", labelKey: "finance", icon: Banknote },
  { href: "/locations/recouvrement", labelKey: "recouvrement", icon: HandCoins },
  { href: "/finance/charges", labelKey: "charges", icon: Calculator },
  { href: "/patrimoine/assurances", labelKey: "assurances", icon: Umbrella },
  { href: "/travaux", labelKey: "travaux", icon: Wrench },
  { href: "/travaux/sinistres", labelKey: "sinistres", icon: Siren },
  { href: "/inbox", labelKey: "inbox", icon: Inbox },
  { href: "/recherche", labelKey: "recherche", icon: Search },
  { href: "/echeancier", labelKey: "echeancier", icon: CalendarClock },
  { href: "/documents", labelKey: "documents", icon: FileText },
  { href: "/parametres/securite", labelKey: "parametres", icon: ShieldCheck },
];

export const adminNav: NavItem[] = [
  { href: "/admin/ops", labelKey: "ops", icon: Terminal, ownerAdminOnly: true },
];
