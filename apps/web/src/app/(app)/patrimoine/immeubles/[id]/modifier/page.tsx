import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { BuildingForm } from "@/components/patrimoine/building-form";
import { readOrNotFound } from "@/server/patrimoine/page-data";
import { getBuilding, listLegalEntities } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimoine");
  return { title: t("building.editTitle") };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations("patrimoine");
  const { building, entities } = await readOrNotFound(async (tx) => ({
    building: await getBuilding(tx, id),
    entities: await listLegalEntities(tx, { limit: 200 }),
  }));

  return (
    <>
      <PageNav title={t("building.editTitle")} description={building.name} />
      <BuildingForm entities={entities.items} building={building} />
    </>
  );
}
