import { cn } from "cn";

export const EMPTY = "—";

type Props = {
  /** Decimal string, never a float (tech pack P16). */
  amount: string | null | undefined;
  currency?: string;
  className?: string;
};

export function formatMoney(amount: string, currency = "EUR"): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return EMPTY;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function Money({ amount, currency = "EUR", className }: Props) {
  if (amount === null || amount === undefined || amount === "") {
    return <span className={cn("num text-muted-foreground", className)}>{EMPTY}</span>;
  }
  return <span className={cn("num", className)}>{formatMoney(amount, currency)}</span>;
}
