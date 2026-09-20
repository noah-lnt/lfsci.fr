import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InterventionForm } from "@/components/travaux/intervention-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("travaux.interventions.form");
  return { title: t("title") };
}

export default function Page() {
  return <InterventionForm />;
}
