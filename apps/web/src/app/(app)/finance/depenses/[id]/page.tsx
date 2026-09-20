import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExpenseDetail } from "@/components/finance/expense-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.expenses.detail");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExpenseDetail id={id} />;
}
