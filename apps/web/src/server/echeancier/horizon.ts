import type { DeadlineHorizon } from "@/lib/contracts/echeancier";

export const HORIZONS: DeadlineHorizon[] = ["overdue", "d7", "d30", "d90", "d365", "later"];

const BOUNDS: [DeadlineHorizon, number][] = [
  ["d7", 7],
  ["d30", 30],
  ["d90", 90],
  ["d365", 365],
];

/** TMP-03: late is its own bucket, never folded into "7 jours". */
export function horizonOf(dueOn: string, today: string): DeadlineHorizon {
  const days = Math.round(
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (days < 0) return "overdue";
  for (const [name, limit] of BOUNDS) if (days <= limit) return name;
  return "later";
}

export function countByHorizon(
  items: { horizon: DeadlineHorizon }[],
): Record<DeadlineHorizon, number> {
  const counts = Object.fromEntries(HORIZONS.map((name) => [name, 0])) as Record<
    DeadlineHorizon,
    number
  >;
  for (const item of items) counts[item.horizon] += 1;
  return counts;
}
