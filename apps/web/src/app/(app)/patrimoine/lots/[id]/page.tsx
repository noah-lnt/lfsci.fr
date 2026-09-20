import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { ObjectTabs } from "@/components/patrimoine/object-tabs";
import { SummaryList, Text } from "@/components/patrimoine/summary-list";
import { UsageForm } from "@/components/patrimoine/usage-form";
import { DateValue } from "@/components/ui/date";
import { LinkButton } from "@/components/ui/link-button";
import { readOrNotFound } from "@/server/patrimoine/page-data";
import { getBuilding, getUnit } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const unit = await readOrNotFound((tx) => getUnit(tx, id));
  return { title: unit.label };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const t = await getTranslations("patrimoine");
  const { unit, building } = await readOrNotFound(async (tx) => {
    const found = await getUnit(tx, id);
    return { unit: found, building: await getBuilding(tx, found.buildingId) };
  });

  const current = unit.usagePeriods.find((period) => period.endsOn === null);

  const summary = (
    <div className="space-y-6">
      <SummaryList
        entries={[
          {
            label: t("unit.building"),
            value: (
              <Link href={`/patrimoine/immeubles/${building.id}`} className="hover:underline">
                {building.code} — {building.name}
              </Link>
            ),
          },
          { label: t("unit.code"), value: <Text value={unit.code} /> },
          { label: t("unit.kind"), value: t(`unitKind.${unit.kind}`) },
          { label: t("unit.floor"), value: <Text value={unit.floor} /> },
          { label: t("unit.roomCount"), value: <Text value={unit.roomCount} /> },
          { label: t("unit.livingAreaSqm"), value: <Text value={unit.livingAreaSqm} /> },
          { label: t("unit.ownershipShare"), value: <Text value={unit.ownershipShare} /> },
          { label: t("unit.energyClass"), value: <Text value={unit.energyClass} /> },
          { label: t("unit.energyAuditOn"), value: <DateValue value={unit.energyAuditOn} /> },
          { label: t("unit.status"), value: t(`unitStatus.${unit.status}`) },
          {
            label: t("unit.usageCurrent"),
            value: current ? t(`usage.${current.usage}`) : <Text value={null} />,
          },
        ]}
      />

      <UsageForm unitId={unit.id} periods={unit.usagePeriods} />
    </div>
  );

  return (
    <>
      <PageNav title={unit.label} description={`${t("unit.one")} · ${unit.code}`}>
        <LinkButton
          href={`/patrimoine/lots/${unit.id}/modifier`}
          variant="outline"
          size="lg"
          className="h-11 sm:h-9"
        >
          {t("edit")}
        </LinkButton>
      </PageNav>

      <ObjectTabs object={{ kind: "unit", id: unit.id }} summary={summary} />
    </>
  );
}
