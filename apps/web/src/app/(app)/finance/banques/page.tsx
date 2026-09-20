import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BanksView } from "@/components/finance/banks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.banks");
  return { title: t("title") };
}

export default function Page() {
  return <BanksView />;
}
