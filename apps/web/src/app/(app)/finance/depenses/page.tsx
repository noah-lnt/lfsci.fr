import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExpensesTable } from "@/components/finance/expenses-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.expenses");
  return { title: t("title") };
}

export default function Page() {
  return <ExpensesTable />;
}
