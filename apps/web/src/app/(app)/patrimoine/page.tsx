import { Building2 } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageNav } from "@/components/layout/page-nav";
import { PatrimoineTree } from "@/components/patrimoine/patrimoine-tree";
import { LinkButton } from "@/components/ui/link-button";
import { readScoped } from "@/server/patrimoine/page-data";
import { readTree } from "@/server/patrimoine/repository";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages.patrimoine");
  return { title: t("title") };
}

export default async function Page() {
  const t = await getTranslations("pages.patrimoine");
  const actions = await getTranslations("patrimoine");
  const today = new Date().toISOString().slice(0, 10);
  const entities = await readScoped((tx) => readTree(tx, today));

  return (
    <>
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<Building2 className="size-5" aria-hidden="true" />}
      >
        <LinkButton href="/patrimoine/immeubles/nouveau" size="lg" className="h-11 sm:h-9">
          {actions("addBuilding")}
        </LinkButton>
        <LinkButton
          href="/patrimoine/sci/nouveau"
          variant="outline"
          size="lg"
          className="h-11 sm:h-9"
        >
          {actions("addEntity")}
        </LinkButton>
      </PageNav>

      <PatrimoineTree entities={entities} />
    </>
  );
}
