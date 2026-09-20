import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EquipmentView } from "@/components/travaux/equipment-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("travaux.equipment");
  return { title: t("title") };
}

export default function Page() {
  return <EquipmentView />;
}
