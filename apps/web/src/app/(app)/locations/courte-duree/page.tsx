import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ListingsView } from "@/components/courte-duree/listings-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("courteDuree");
  return { title: t("listings.title") };
}

export default function Page() {
  return <ListingsView />;
}
