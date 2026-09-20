import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AssetDetail } from "@/components/finance/assets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.assets.detail");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AssetDetail id={id} />;
}
