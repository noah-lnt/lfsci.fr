import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OpportunityForm } from "@/components/acquisitions/opportunities";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acquisitions.form");
  return { title: t("title") };
}

export default function Page() {
  return <OpportunityForm />;
}
