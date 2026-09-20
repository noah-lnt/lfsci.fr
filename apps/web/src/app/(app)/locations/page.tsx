import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { LeasesView } from "@/components/locations/leases-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("locations");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("locations");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<KeyRound className="size-5" aria-hidden="true" />}
      />
      <LeasesView />
    </>
  );
}
