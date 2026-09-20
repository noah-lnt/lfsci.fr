import { cn } from "cn";
import { EMPTY } from "./money";

type Props = {
  /** `YYYY-MM-DD` for civil dates, ISO-8601 with offset for instants. */
  value: string | null | undefined;
  withTime?: boolean;
  className?: string;
};

export function formatDate(value: string, withTime = false): string {
  const isCivilDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(isCivilDate ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return EMPTY;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Europe/Paris",
  }).format(parsed);
}

export function DateValue({ value, withTime = false, className }: Props) {
  if (!value) return <span className={cn("num text-muted-foreground", className)}>{EMPTY}</span>;
  return (
    <time dateTime={value} className={cn("num", className)}>
      {formatDate(value, withTime)}
    </time>
  );
}
