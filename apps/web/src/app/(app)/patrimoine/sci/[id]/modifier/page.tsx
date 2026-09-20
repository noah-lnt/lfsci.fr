import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { LegalEntityForm } from "@/components/patrimoine/legal-entity-form";
import { readOrNotFound } from "@/server/patrimoine/page-data";
import { getLegalEntity } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimoine");
  return { title: t("entity.editTitle") };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations("patrimoine");
  const entity = await readOrNotFound((tx) => getLegalEntity(tx, id));

  return (
    <>
      <PageNav title={t("entity.editTitle")} description={entity.name} />
      <LegalEntityForm entity={entity} />
    </>
  );
}
