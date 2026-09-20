import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageNav } from "@/components/layout/page-nav";
import { UnitForm } from "@/components/patrimoine/unit-form";
import { readScoped } from "@/server/patrimoine/page-data";
import { listBuildings } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ immeuble?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("patrimoine");
  return { title: t("unit.newTitle") };
}

export default async function Page({ searchParams }: Props) {
  const t = await getTranslations("patrimoine");
  const { immeuble } = await searchParams;
  const buildings = await readScoped((tx) => listBuildings(tx, { limit: 200 }));

  return (
    <>
      <PageNav title={t("unit.newTitle")} />
      {buildings.items.length === 0 ? (
        <EmptyState title={t("unit.newTitle")}>{t("tree.empty")}</EmptyState>
      ) : (
        <UnitForm
          buildings={buildings.items}
          {...(immeuble ? { defaultBuildingId: immeuble } : {})}
        />
      )}
    </>
  );
}
