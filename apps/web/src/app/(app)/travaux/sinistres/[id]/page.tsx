import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClaimDetail } from "@/components/assurances/claim-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sinistres");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimDetail id={id} />;
}
