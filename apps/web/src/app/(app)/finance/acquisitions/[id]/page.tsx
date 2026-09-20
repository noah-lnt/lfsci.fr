import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OpportunityView } from "@/components/acquisitions/opportunities";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("acquisitions.detail");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpportunityView id={id} />;
}
