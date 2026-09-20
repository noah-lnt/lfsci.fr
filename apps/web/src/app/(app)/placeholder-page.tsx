import type { ReactNode } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageNav } from "@/components/layout/page-nav";

type Props = { title: string; description: string; empty: string; icon: ReactNode };

/** Every screen of spec UX-02 ships with its own French empty state. */
export function PlaceholderPage({ title, description, empty, icon }: Props) {
  return (
    <>
      <PageNav title={title} description={description} icon={icon} />
      <EmptyState title={title}>{empty}</EmptyState>
    </>
  );
}
