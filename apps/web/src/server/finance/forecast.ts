import "server-only";
import type { api } from "@lfsci/contracts";
import { decimal, toMoney, ZERO } from "@lfsci/domain";
import type { z } from "zod";

type Forecast = z.infer<typeof api.finance.getCashForecast.output>;
type Bucket = Forecast["buckets"][number];
export type ForecastSource = Bucket["sources"][number];

export type ForecastEvent = {
  on: string;
  /** Signed: positive is an expected receipt, negative a committed outflow. */
  amount: string;
  source: ForecastSource;
};

export type ForecastInput = {
  asOf: string;
  horizonDays: Forecast["horizonDays"];
  currency: string;
  /** TRE-01: realised bank cash only — an expected receipt is never cash. */
  openingBalance: string;
  events: readonly ForecastEvent[];
  missingSources: readonly string[];
};

/**
 * TRE-01: a rolling forecast, one bucket per day that carries a movement.
 * Inflows stay "prévu" and outflows "engagé"; the opening balance is the only
 * "réalisé" figure, which is why it never absorbs an expected receipt.
 */
export function aggregateForecast(input: ForecastInput): Forecast {
  const horizonEnd = addDays(input.asOf, Number(input.horizonDays));
  const inWindow = input.events.filter((event) => event.on >= input.asOf && event.on <= horizonEnd);

  const byDate = new Map<
    string,
    { inflow: typeof ZERO; outflow: typeof ZERO; sources: Set<ForecastSource> }
  >();
  for (const event of inWindow) {
    const bucket = byDate.get(event.on) ?? { inflow: ZERO, outflow: ZERO, sources: new Set() };
    const value = decimal(event.amount);
    if (value.isNegative()) bucket.outflow = bucket.outflow.plus(value.negated());
    else bucket.inflow = bucket.inflow.plus(value);
    bucket.sources.add(event.source);
    byDate.set(event.on, bucket);
  }

  let balance = decimal(input.openingBalance);
  const buckets: Bucket[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([on, bucket]) => {
      balance = balance.plus(bucket.inflow).minus(bucket.outflow);
      return {
        on,
        inflow: toMoney(bucket.inflow),
        outflow: toMoney(bucket.outflow),
        balance: toMoney(balance),
        sources: [...bucket.sources].sort(),
      };
    });

  return {
    horizonDays: input.horizonDays,
    currency: input.currency,
    openingBalance: toMoney(decimal(input.openingBalance)),
    closingBalance: toMoney(balance),
    asOf: input.asOf,
    buckets,
    missingSources: [...input.missingSources],
  };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
