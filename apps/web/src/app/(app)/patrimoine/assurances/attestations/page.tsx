import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AttestationsView } from "@/components/assurances/attestations-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assurances.attestations");
  return { title: t("title") };
}

export default function Page() {
  return <AttestationsView />;
}
