import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoansTable } from "@/components/finance/loans";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.loans");
  return { title: t("title") };
}

export default function Page() {
  return <LoansTable />;
}
