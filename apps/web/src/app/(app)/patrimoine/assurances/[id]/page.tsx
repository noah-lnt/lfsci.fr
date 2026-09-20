import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PolicyDetail } from "@/components/assurances/policy-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assurances.detail");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PolicyDetail id={id} />;
}
