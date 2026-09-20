import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoanSchedule } from "@/components/finance/loans";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.loans.schedule");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LoanSchedule id={id} />;
}
