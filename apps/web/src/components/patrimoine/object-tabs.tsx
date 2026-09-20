"use client";

import type { ObjectRef } from "@lfsci/contracts";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DocumentPanel } from "@/components/documents/document-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimelinePanel } from "./timeline-panel";

type Props = { object: ObjectRef; summary: ReactNode };

/** Spec UX-02: every record exposes synthèse, timeline and documents. */
export function ObjectTabs({ object, summary }: Props) {
  const t = useTranslations("patrimoine");
  return (
    <Tabs defaultValue="summary">
      <TabsList variant="line">
        <TabsTrigger value="summary">{t("tabs.summary")}</TabsTrigger>
        <TabsTrigger value="timeline">{t("tabs.timeline")}</TabsTrigger>
        <TabsTrigger value="documents">{t("tabs.documents")}</TabsTrigger>
      </TabsList>
      <TabsContent value="summary" className="pt-4">
        {summary}
      </TabsContent>
      <TabsContent value="timeline" className="pt-4">
        <TimelinePanel object={object} />
      </TabsContent>
      <TabsContent value="documents" className="pt-4">
        <DocumentPanel object={object} />
      </TabsContent>
    </Tabs>
  );
}
