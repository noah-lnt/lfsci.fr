import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { ObjectTabs } from "@/components/patrimoine/object-tabs";
import { SummaryList, Text } from "@/components/patrimoine/summary-list";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { readOrNotFound } from "@/server/patrimoine/page-data";
import { getLegalEntity, listBuildings } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const entity = await readOrNotFound((tx) => getLegalEntity(tx, id));
  return { title: entity.name };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations("patrimoine");
  const { entity, buildings } = await readOrNotFound(async (tx) => ({
    entity: await getLegalEntity(tx, id),
    buildings: await listBuildings(tx, { limit: 200, legalEntityId: id }),
  }));

  const summary = (
    <div className="space-y-6">
      <SummaryList
        entries={[
          { label: t("entity.legalForm"), value: t(`legalForm.${entity.legalForm}`) },
          { label: t("entity.siren"), value: <Text value={entity.siren} /> },
          {
            label: t("entity.incomeTaxRegime"),
            value: t(`incomeTaxRegime.${entity.incomeTaxRegime}`),
          },
          { label: t("entity.vatStatus"), value: t(`vatStatus.${entity.vatStatus}`) },
          { label: t("entity.status"), value: t(`entityStatus.${entity.status}`) },
          { label: t("entity.currency"), value: <Text value={entity.currency} /> },
          {
            label: t("entity.fiscalYearEnd"),
            value:
              entity.fiscalYearEndDay && entity.fiscalYearEndMonth ? (
                `${entity.fiscalYearEndDay}/${entity.fiscalYearEndMonth}`
              ) : (
                <Text value={null} />
              ),
          },
        ]}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("building.one")}</h2>
        {buildings.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {buildings.items.map((building) => (
              <li key={building.id}>
                <Link
                  href={`/patrimoine/immeubles/${building.id}`}
                  className="font-medium hover:underline"
                >
                  {building.code} — {building.name}
                </Link>{" "}
                <span className="text-muted-foreground">
                  <Text value={building.city} /> · <DateValue value={building.acquiredOn} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <>
      <PageNav title={entity.name} description={t("entity.one")}>
        <Button
          variant="outline"
          size="lg"
          className="h-11 sm:h-9"
          render={<Link href={`/patrimoine/sci/${entity.id}/modifier`} />}
        >
          {t("edit")}
        </Button>
        <Button
          size="lg"
          className="h-11 sm:h-9"
          render={<Link href={`/patrimoine/immeubles/nouveau?sci=${entity.id}`} />}
        >
          {t("addBuilding")}
        </Button>
      </PageNav>

      <ObjectTabs object={{ kind: "legal_entity", id: entity.id }} summary={summary} />
    </>
  );
}
