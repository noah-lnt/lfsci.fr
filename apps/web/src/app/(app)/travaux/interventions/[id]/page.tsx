import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InterventionDetail } from "@/components/travaux/intervention-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("travaux.interventions.detail");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InterventionDetail id={id} />;
}
