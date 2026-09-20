import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TravauxOverview } from "@/components/travaux/overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("travaux");
  return { title: t("title") };
}

export default function Page() {
  return <TravauxOverview />;
}
