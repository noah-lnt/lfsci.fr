import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FinanceDashboard } from "@/components/finance/dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance");
  return { title: t("title") };
}

export default function Page() {
  return <FinanceDashboard />;
}
