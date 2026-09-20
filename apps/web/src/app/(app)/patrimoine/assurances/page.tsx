import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PoliciesView } from "@/components/assurances/policies-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assurances");
  return { title: t("title") };
}

export default function Page() {
  return <PoliciesView />;
}
