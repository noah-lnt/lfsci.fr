import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LeaseDetailView } from "@/components/locations/lease-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("locations");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeaseDetailView leaseId={id} />;
}
