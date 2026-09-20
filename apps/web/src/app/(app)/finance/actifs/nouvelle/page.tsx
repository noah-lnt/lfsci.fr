import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AssetForm } from "@/components/finance/assets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.assets.form");
  return { title: t("title") };
}

export default function Page() {
  return <AssetForm />;
}
