import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RunsView } from "./runs-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("charges");
  return { title: t("title") };
}

export default function Page() {
  return <RunsView />;
}
