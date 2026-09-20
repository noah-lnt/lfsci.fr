import { Home } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HomeView } from "@/components/accueil/home-view";
import { PageNav } from "@/components/layout/page-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accueil");
  return { title: t("title") };
}

export default async function AccueilPage() {
  const t = await getTranslations("accueil");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Home className="size-5" aria-hidden="true" />}
      />
      <HomeView />
    </>
  );
}
