import { Terminal } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { activeRole } from "@/server/session";
import { OpsConsole } from "./ops-console";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.ops");
  return { title: t("title") };
}

export default async function OpsPage() {
  // Tech pack §10: an unauthorised read answers 404, never 403.
  if ((await activeRole()) !== "owner_admin") notFound();

  const t = await getTranslations("pages.ops");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Terminal className="size-5" aria-hidden="true" />}
      />
      <OpsConsole />
    </>
  );
}
