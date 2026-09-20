import { Search } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { SearchView } from "@/components/recherche/search-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recherche");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("recherche");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Search className="size-5" aria-hidden="true" />}
      />
      <SearchView />
    </>
  );
}
