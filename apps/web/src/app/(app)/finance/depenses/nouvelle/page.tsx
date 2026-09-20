import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExpenseForm } from "@/components/finance/expense-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.expenses.form");
  return { title: t("title") };
}

export default function Page() {
  return <ExpenseForm />;
}
