import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { LegalEntityForm } from "@/components/patrimoine/legal-entity-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimoine");
  return { title: t("entity.newTitle") };
}

export default async function Page() {
  const t = await getTranslations("patrimoine");
  return (
    <>
      <PageNav title={t("entity.newTitle")} />
      <LegalEntityForm />
    </>
  );
}
