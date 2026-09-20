import type { ReactNode } from "react";

type Props = { title: string; children: ReactNode };

export function EmptyState({ title, children }: Props) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-8 text-center">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
