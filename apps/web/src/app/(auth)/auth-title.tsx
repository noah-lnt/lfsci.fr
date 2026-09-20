import type { ReactNode } from "react";

/** The card title of an auth screen is the document heading. */
export function AuthTitle({ children }: { children: ReactNode }) {
  return (
    <h1 data-slot="card-title" className="font-heading text-base leading-snug font-medium">
      {children}
    </h1>
  );
}
