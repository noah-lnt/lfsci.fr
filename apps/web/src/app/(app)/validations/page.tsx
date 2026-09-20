import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ValidationsView } from "@/components/commands/validations-view";
import { PageNav } from "@/components/layout/page-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("validations");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("validations");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
      />
      <ValidationsView />
    </>
  );
}
