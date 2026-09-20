import type { ReactNode } from "react";

export type SummaryEntry = { label: string; value: ReactNode };

/** Caption row / value row grid: labels and controls line up by construction. */
export function SummaryList({ entries }: { entries: SummaryEntry[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
      {entries.map((entry) => (
        <div key={entry.label} className="contents">
          <dt className="text-muted-foreground">{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Text({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  return <>{value}</>;
}
