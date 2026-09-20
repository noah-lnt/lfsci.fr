import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CcaView } from "@/components/finance/cca-ledger";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("finance.cca");
  return { title: t("title") };
}

export default function Page() {
  return <CcaView />;
}
