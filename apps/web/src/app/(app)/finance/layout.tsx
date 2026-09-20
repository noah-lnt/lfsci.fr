import { Banknote } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { FinanceTabs } from "@/components/finance/finance-tabs";
import { PageNav } from "@/components/layout/page-nav";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("finance");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Banknote className="size-5" aria-hidden="true" />}
      />
      <FinanceTabs />
      {children}
    </>
  );
}
