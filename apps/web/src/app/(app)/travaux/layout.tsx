import { Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageNav } from "@/components/layout/page-nav";
import { TravauxTabs } from "@/components/travaux/travaux-tabs";

export default async function TravauxLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("travaux");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Wrench className="size-5" aria-hidden="true" />}
      />
      <TravauxTabs />
      {children}
    </>
  );
}
