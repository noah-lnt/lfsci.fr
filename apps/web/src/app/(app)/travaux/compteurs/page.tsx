import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MetersView } from "@/components/travaux/meters-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("travaux.meters");
  return { title: t("title") };
}

export default function Page() {
  return <MetersView />;
}
