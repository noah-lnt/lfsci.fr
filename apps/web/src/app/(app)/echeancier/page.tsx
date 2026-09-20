import { CalendarClock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EcheancierView } from "@/components/echeancier/echeancier-view";
import { PageNav } from "@/components/layout/page-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("echeancier");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("echeancier");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<CalendarClock className="size-5" aria-hidden="true" />}
      />
      <EcheancierView />
    </>
  );
}
