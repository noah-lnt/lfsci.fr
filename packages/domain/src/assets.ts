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
