import { Inbox } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InboxView } from "@/components/inbox/inbox-view";
import { PageNav } from "@/components/layout/page-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inbox");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("inbox");
  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Inbox className="size-5" aria-hidden="true" />}
      />
      <InboxView />
    </>
  );
}
