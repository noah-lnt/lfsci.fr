import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { KeysView } from "../keys-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges.keys");
  return { title: t("title") };
}

export default function Page() {
  return <KeysView />;
}
