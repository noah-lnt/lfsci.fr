import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ClaimsView } from "@/components/assurances/claims-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sinistres");
  return { title: t("title") };
}

export default function Page() {
  return <ClaimsView />;
}
