import { Umbrella } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AssurancesTabs } from "@/components/assurances/assurances-tabs";
import { PageNav } from "@/components/layout/page-nav";

export default async function AssurancesLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("assurances");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Umbrella className="size-5" aria-hidden="true" />}
      />
      <AssurancesTabs />
      {children}
    </>
  );
}
