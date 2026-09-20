import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CourteDureeTabs } from "@/components/courte-duree/ui";
import { PageNav } from "@/components/layout/page-nav";

export default async function Layout({ children }: { children: ReactNode }) {
  const t = await getTranslations("courteDuree");
  return (
    <div className="space-y-6">
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<CalendarDays className="size-5" aria-hidden="true" />}
      />
      <CourteDureeTabs />
      {children}
    </div>
  );
}
