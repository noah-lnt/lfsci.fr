import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OpportunitiesTable } from "@/components/acquisitions/opportunities";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acquisitions");
  return { title: t("title") };
}

export default function Page() {
  return <OpportunitiesTable />;
}
