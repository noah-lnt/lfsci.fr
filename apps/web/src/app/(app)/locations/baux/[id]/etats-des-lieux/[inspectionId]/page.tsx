import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InspectionCapture } from "@/components/inspections/inspection-capture";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("inspections");
  return { title: t("capture.title") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; inspectionId: string }>;
}) {
  const { id, inspectionId } = await params;
  return <InspectionCapture leaseId={id} inspectionId={inspectionId} />;
}
