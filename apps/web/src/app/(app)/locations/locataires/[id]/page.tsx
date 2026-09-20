import { User } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { TenantDetailView } from "@/components/locations/tenants-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("locations");
  return { title: t("tenant.title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("locations");
  return (
    <>
      <PageNav
        title={t("tenant.title")}
        description={t("tenantsDescription")}
        icon={<User className="size-5" aria-hidden="true" />}
      />
      <TenantDetailView personId={id} />
    </>
  );
}
