import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { UnitForm } from "@/components/patrimoine/unit-form";
import { readOrNotFound } from "@/server/patrimoine/page-data";
import { getBuilding, getUnit } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimoine");
  return { title: t("unit.editTitle") };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations("patrimoine");
  const { unit, building } = await readOrNotFound(async (tx) => {
    const found = await getUnit(tx, id);
    return { unit: found, building: await getBuilding(tx, found.buildingId) };
  });

  return (
    <>
      <PageNav title={t("unit.editTitle")} description={unit.label} />
      <UnitForm buildings={[building]} unit={unit} />
    </>
  );
}
