import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BookingDetailView } from "@/components/courte-duree/booking-detail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("courteDuree");
  return { title: t("bookings.title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingDetailView bookingId={id} />;
}
