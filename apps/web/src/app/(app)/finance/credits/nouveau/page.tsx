import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoanForm } from "@/components/finance/loans";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.loans.form");
  return { title: t("title") };
}

export default function Page() {
  return <LoanForm />;
}
