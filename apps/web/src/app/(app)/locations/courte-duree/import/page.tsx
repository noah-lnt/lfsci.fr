import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImportWizard } from "@/components/courte-duree/import-wizard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("courteDuree");
  return { title: t("import.title") };
}

export default function Page() {
  return <ImportWizard />;
}
