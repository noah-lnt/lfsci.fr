import { FilePlus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { LeaseForm } from "@/components/locations/lease-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("locations");
  return { title: t("newLeaseTitle") };
}

export default async function Page() {
  const t = await getTranslations("locations");
  return (
    <>
      <PageNav
        title={t("newLeaseTitle")}
        description={t("newLeaseDescription")}
        icon={<FilePlus className="size-5" aria-hidden="true" />}
      />
      <LeaseForm />
    </>
  );
}
