import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { SecuriteView } from "./securite-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("parametres.securite");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("parametres.securite");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
      />
      <SecuriteView />
    </>
  );
}
