import { HandCoins } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { RecouvrementView } from "./recouvrement-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recouvrement");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("recouvrement");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<HandCoins className="size-5" aria-hidden="true" />}
      />
      <RecouvrementView />
    </>
  );
}
