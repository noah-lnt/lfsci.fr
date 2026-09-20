import { Decimal } from "decimal.js";
import { money, sum, toMoney, ZERO } from "./money";
import {
  addMonthsIso,
  daysBetween,
  type IsoDateString,
  monthlyPeriods,
  overlapRange,
  previousDay,
} from "./periods";

export type ComponentKind = "land" | "building" | "equipment" | "works";

export type DepreciableComponent = {
  id: string;
  kind: ComponentKind;
  gross: string;
  startDate: IsoDateString;
  months: number;
};

export type DepreciationSlice = {
  periodStart: IsoDateString;
  periodEnd: IsoDateString;
  amount: string;
};

// IMM-02 : le terrain n'est jamais amortissable.
export function isDepreciable(kind: ComponentKind): boolean {
  return kind !== "land";
}

// Prorata temporis en mois d'exposition : un mois entier vaut 1, un mois partiel
// vaut jours/joursDuMois. L'amortissement d'une période est la différence de deux
// cumuls arrondis, ce qui interdit toute dérive du total.
function monthsExposed(component: DepreciableComponent, at: IsoDateString): Decimal {
  if (!isDepreciable(component.kind) || component.months <= 0) return ZERO;
  if (at < component.startDate) return ZERO;
  const lastDay = previousDay(addMonthsIso(component.startDate, component.months));
  const periods = monthlyPeriods({ start: component.startDate, end: lastDay });
  return periods.reduce<Decimal>((acc, period) => {
    const overlap = overlapRange(period, { start: component.startDate, end: at });
    if (overlap === null) return acc;
    const days = daysBetween(overlap.start, overlap.end);
    return acc.plus(new Decimal(days).dividedBy(period.daysInMonth));
  }, ZERO);
}

export function accumulatedAt(component: DepreciableComponent, at: IsoDateString): string {
  if (!isDepreciable(component.kind) || component.months <= 0) return toMoney(ZERO);
  const exposed = Decimal.min(monthsExposed(component, at), component.months);
  return toMoney(money(component.gross).times(exposed).dividedBy(component.months));
}

export function depreciationBetween(
  component: DepreciableComponent,
  window: { start: IsoDateString; end: IsoDateString },
): string {
  const before = money(accumulatedAt(component, previousDay(window.start)));
  const after = money(accumulatedAt(component, window.end));
  return toMoney(after.minus(before));
}

export function straightLineSchedule(component: DepreciableComponent): DepreciationSlice[] {
  if (!isDepreciable(component.kind) || component.months <= 0) return [];
  const lastDay = previousDay(addMonthsIso(component.startDate, component.months));
  return monthlyPeriods({ start: component.startDate, end: lastDay }).map((period) => ({
    periodStart: period.start,
    periodEnd: period.end,
    amount: depreciationBetween(component, { start: period.start, end: period.end }),
  }));
}

export function netBookValueAt(component: DepreciableComponent, at: IsoDateString): string {
  return toMoney(money(component.gross).minus(money(accumulatedAt(component, at))));
}

export type AssetPosition = {
  gross: string;
  accumulatedDepreciation: string;
  netBookValue: string;
  debts: string;
  accountingEquity: string;
  marketValue: string;
  economicNetValue: string;
  economicNetValueIsBeforeDisposalCostsAndTax: true;
  components: {
    id: string;
    kind: ComponentKind;
    gross: string;
    accumulated: string;
    nbv: string;
  }[];
};

// IMM-01 / F07 : la valeur nette économique (marché − dettes) reste distincte
// des capitaux propres comptables ; une réestimation ne touche aucune écriture.
export function assetPosition(input: {
  components: readonly { id: string; kind: ComponentKind; gross: string; accumulated: string }[];
  debts: string;
  marketValue: string;
}): AssetPosition {
  const components = input.components.map((c) => {
    const accumulated = isDepreciable(c.kind) ? money(c.accumulated) : ZERO;
    return {
      id: c.id,
      kind: c.kind,
      gross: toMoney(money(c.gross)),
      accumulated: toMoney(accumulated),
      nbv: toMoney(money(c.gross).minus(accumulated)),
    };
  });
  const gross = sum(components.map((c) => money(c.gross)));
  const accumulated = sum(components.map((c) => money(c.accumulated)));
  const nbv = gross.minus(accumulated);
  const debts = money(input.debts);
  const marketValue = money(input.marketValue);
  return {
    gross: toMoney(gross),
    accumulatedDepreciation: toMoney(accumulated),
    netBookValue: toMoney(nbv),
    debts: toMoney(debts),
    accountingEquity: toMoney(nbv.minus(debts)),
    marketValue: toMoney(marketValue),
    economicNetValue: toMoney(marketValue.minus(debts)),
    economicNetValueIsBeforeDisposalCostsAndTax: true,
    components,
  };
}

// IMM-02 : ces durées ne sont pas une politique validée, seulement le repli
// appliqué tant que le propriétaire n'a pas arrêté les siennes (question 9).
// Une durée lue sur l'actif l'emporte toujours et l'écran dit laquelle a servi.
export const DEFAULT_DURATION_YEARS: Record<ComponentKind, number> = {
  land: 0,
  building: 30,
  equipment: 10,
  works: 15,
};

export type DurationSource = "asset" | "default" | "none";

export type ResolvedDuration = { months: number; years: number; source: DurationSource };

export function resolveDepreciationMonths(input: {
  kind: ComponentKind;
  durationYears?: string | number | null | undefined;
}): ResolvedDuration {
  if (!isDepreciable(input.kind)) return { months: 0, years: 0, source: "none" };
  const stated =
    input.durationYears === null || input.durationYears === undefined
      ? Number.NaN
      : Number(input.durationYears);
  if (Number.isFinite(stated) && stated > 0) {
    return { months: Math.round(stated * 12), years: stated, source: "asset" };
  }
  const fallback = DEFAULT_DURATION_YEARS[input.kind];
  if (fallback <= 0) return { months: 0, years: 0, source: "none" };
  return { months: Math.round(fallback * 12), years: fallback, source: "default" };
}

export type RegisterComponent = {
  id: string;
  label: string;
  kind: ComponentKind;
  gross: string;
  startDate: IsoDateString | null;
  durationYears?: string | number | null | undefined;
};

export type RegisterLine = {
  id: string;
  label: string;
  kind: ComponentKind;
  gross: string;
  accumulated: string;
  netBookValue: string;
  durationMonths: number;
  durationYears: number;
  durationSource: DurationSource;
  computable: boolean;
};

export type AssetRegister = {
  asOf: IsoDateString;
  gross: string;
  land: string;
  depreciableGross: string;
  accumulated: string;
  netBookValue: string;
  lines: RegisterLine[];
  usesDefaultDuration: boolean;
};

/**
 * IMM-01 : le registre additionne des composants, jamais une proportion
 * terrain/construction déduite. Un composant sans date de mise en service
 * n'est pas amorti : il est brut, et la ligne le dit.
 */
export function assetRegister(input: {
  asOf: IsoDateString;
  components: readonly RegisterComponent[];
}): AssetRegister {
  const lines = input.components.map<RegisterLine>((component) => {
    const duration = resolveDepreciationMonths(component);
    const computable =
      component.startDate !== null && duration.months > 0 && isDepreciable(component.kind);
    const accumulated = computable
      ? accumulatedAt(
          {
            id: component.id,
            kind: component.kind,
            gross: component.gross,
            startDate: component.startDate as IsoDateString,
            months: duration.months,
          },
          input.asOf,
        )
      : toMoney(ZERO);
    return {
      id: component.id,
      label: component.label,
      kind: component.kind,
      gross: toMoney(money(component.gross)),
      accumulated,
      netBookValue: toMoney(money(component.gross).minus(money(accumulated))),
      durationMonths: duration.months,
      durationYears: duration.years,
      durationSource: duration.source,
      computable,
    };
  });

  const gross = sum(lines.map((line) => money(line.gross)));
  const land = sum(lines.filter((line) => !isDepreciable(line.kind)).map((l) => money(l.gross)));
  const accumulated = sum(lines.map((line) => money(line.accumulated)));
  return {
    asOf: input.asOf,
    gross: toMoney(gross),
    land: toMoney(land),
    depreciableGross: toMoney(gross.minus(land)),
    accumulated: toMoney(accumulated),
    netBookValue: toMoney(gross.minus(accumulated)),
    lines,
    usesDefaultDuration: lines.some((line) => line.durationSource === "default"),
  };
}

export type AnnualDepreciation = {
  year: number;
  amount: string;
  cumulative: string;
};

/**
 * IMM-01 : la dotation annuelle agrège les tranches mensuelles du composant ;
 * elle ne divise jamais la base par la durée, ce qui perdrait le prorata de la
 * première et de la dernière année.
 */
export function annualDepreciation(components: readonly RegisterComponent[]): AnnualDepreciation[] {
  const byYear = new Map<number, Decimal>();
  for (const component of components) {
    const duration = resolveDepreciationMonths(component);
    if (component.startDate === null || duration.months <= 0) continue;
    const slices = straightLineSchedule({
      id: component.id,
      kind: component.kind,
      gross: component.gross,
      startDate: component.startDate,
      months: duration.months,
    });
    for (const slice of slices) {
      const year = Number(slice.periodStart.slice(0, 4));
      byYear.set(year, (byYear.get(year) ?? ZERO).plus(money(slice.amount)));
    }
  }
  let cumulative = ZERO;
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, amount]) => {
      cumulative = cumulative.plus(amount);
      return { year, amount: toMoney(amount), cumulative: toMoney(cumulative) };
    });
}
