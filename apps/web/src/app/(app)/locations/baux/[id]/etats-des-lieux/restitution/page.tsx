import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DepositSettlementView } from "@/components/inspections/deposit-settlement";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inspections");
  return { title: t("settlement.title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DepositSettlementView leaseId={id} />;
}
