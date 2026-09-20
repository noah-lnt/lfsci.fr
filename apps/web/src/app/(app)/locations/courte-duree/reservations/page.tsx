import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BookingsView } from "@/components/courte-duree/bookings-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("courteDuree");
  return { title: t("bookings.title") };
}

export default function Page() {
  return <BookingsView />;
}
