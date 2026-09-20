import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { ObjectTabs } from "@/components/patrimoine/object-tabs";
import { SummaryList, Text } from "@/components/patrimoine/summary-list";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import { readOrNotFound } from "@/server/patrimoine/page-data";
import { getBuilding, getLegalEntity, listUnits } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const building = await readOrNotFound((tx) => getBuilding(tx, id));
  return { title: building.name };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations("patrimoine");
  const { building, entity, units } = await readOrNotFound(async (tx) => {
    const found = await getBuilding(tx, id);
    return {
      building: found,
      entity: await getLegalEntity(tx, found.legalEntityId),
      units: await listUnits(tx, { limit: 200, buildingId: id }),
    };
  });

  const summary = (
    <div className="space-y-6">
      <SummaryList
        entries={[
          {
            label: t("building.legalEntity"),
            value: (
              <Link href={`/patrimoine/sci/${entity.id}`} className="hover:underline">
                {entity.name}
              </Link>
            ),
          },
          { label: t("building.code"), value: <Text value={building.code} /> },
          {
            label: t("building.addressLine1"),
            value: (
              <span>
                {building.addressLine1}
                {building.addressLine2 ? `, ${building.addressLine2}` : ""}
                <br />
                <Text value={building.postalCode} /> <Text value={building.city} />
              </span>
            ),
          },
          { label: t("building.cadastralRef"), value: <Text value={building.cadastralRef} /> },
          { label: t("building.acquiredOn"), value: <DateValue value={building.acquiredOn} /> },
          { label: t("building.soldOn"), value: <DateValue value={building.soldOn} /> },
          { label: t("building.status"), value: t(`buildingStatus.${building.status}`) },
        ]}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("unit.one")}</h2>
        {units.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {units.items.map((unit) => (
              <li key={unit.id}>
                <Link href={`/patrimoine/lots/${unit.id}`} className="font-medium hover:underline">
                  {unit.code} — {unit.label}
                </Link>{" "}
                <span className="text-muted-foreground">{t(`unitKind.${unit.kind}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <>
      <PageNav title={building.name} description={`${t("building.one")} · ${building.code}`}>
        <LinkButton
          href={`/patrimoine/immeubles/${building.id}/modifier`}
          variant="outline"
          size="lg"
          className="h-11 sm:h-9"
        >
          {t("edit")}
        </LinkButton>
        <LinkButton
          href={`/patrimoine/lots/nouveau?immeuble=${building.id}`}
          size="lg"
          className="h-11 sm:h-9"
        >
          {t("addUnit")}
        </LinkButton>
      </PageNav>

      <ObjectTabs object={{ kind: "building", id: building.id }} summary={summary} />
    </>
  );
}
