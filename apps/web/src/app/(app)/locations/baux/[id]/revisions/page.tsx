import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RevisionsView } from "./revisions-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("revisions");
  return { title: t("title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RevisionsView leaseId={id} />;
}
