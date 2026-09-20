import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PayoutsView } from "@/components/courte-duree/payouts-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("courteDuree");
  return { title: t("payouts.title") };
}

export default async function Page() {
  const t = await getTranslations("courteDuree");
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{t("loading")}</p>}>
      <PayoutsView />
    </Suspense>
  );
}
