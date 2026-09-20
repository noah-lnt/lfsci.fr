import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageNav } from "@/components/layout/page-nav";
import { BuildingForm } from "@/components/patrimoine/building-form";
import { readScoped } from "@/server/patrimoine/page-data";
import { listLegalEntities } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ sci?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimoine");
  return { title: t("building.newTitle") };
}

export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("patrimoine");
  const { sci } = await searchParams;
  const entities = await readScoped((tx) => listLegalEntities(tx, { limit: 200 }));

  return (
    <>
      <PageNav title={t("building.newTitle")} />
      {entities.items.length === 0 ? (
        <EmptyState title={t("building.newTitle")}>{t("tree.empty")}</EmptyState>
      ) : (
        <BuildingForm entities={entities.items} {...(sci ? { defaultLegalEntityId: sci } : {})} />
      )}
    </>
  );
}
