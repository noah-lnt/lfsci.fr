import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentLibrary } from "@/components/documents/library";
import { PageNav } from "@/components/layout/page-nav";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.documents");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("pages.documents");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<FileText className="size-5" aria-hidden="true" />}
      />
      <DocumentLibrary />
    </>
  );
}
