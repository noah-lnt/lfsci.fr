import { Users } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { TenantsView } from "@/components/locations/tenants-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("locations");
  return { title: t("tenantsTitle") };
}

export default async function Page() {
  const t = await getTranslations("locations");
  return (
    <>
      <PageNav
        title={t("tenantsTitle")}
        description={t("tenantsDescription")}
        icon={<Users className="size-5" aria-hidden="true" />}
      />
      <TenantsView />
    </>
  );
}
