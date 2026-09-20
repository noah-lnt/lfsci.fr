"use client";

import { Building2, ChevronRight, DoorClosed, Landmark } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TreeUnitView = {
  id: string;
  code: string;
  label: string;
  kind: string;
  status: string;
  currentUsage: string | null;
};
export type TreeBuildingView = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  status: string;
  units: TreeUnitView[];
};
export type TreeEntityView = {
  id: string;
  name: string;
  status: string;
  buildings: TreeBuildingView[];
};

const ALL = "all";
const VACANT_USAGES = new Set(["vacant", "works"]);

function matches(haystack: (string | null)[], needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (query === "") return true;
  return haystack.some((value) => (value ?? "").toLowerCase().includes(query));
}

export function PatrimoineTree({ entities }: { entities: TreeEntityView[] }) {
  const t = useTranslations("patrimoine");
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const usages = t.raw("usage") as Record<string, string>;
  const kinds = t.raw("unitKind") as Record<string, string>;
  const unitStatuses = t.raw("unitStatus") as Record<string, string>;

  const filtered = useMemo(() => {
    return entities
      .map((entity) => ({
        ...entity,
        buildings: entity.buildings
          .map((building) => ({
            ...building,
            units: building.units.filter(
              (unit) =>
                (usage === ALL || (unit.currentUsage ?? "unknown") === usage) &&
                (status === ALL || unit.status === status),
            ),
          }))
          .filter(
            (building) =>
              matches([entity.name, building.name, building.code, building.city], search) ||
              building.units.some((unit) => matches([unit.code, unit.label], search)),
          )
          .filter((building) => usage === ALL || building.units.length > 0),
      }))
      .filter(
        (entity) =>
          entity.buildings.length > 0 || (usage === ALL && matches([entity.name], search)),
      );
  }, [entities, search, usage, status]);

  const chips = [
    search.trim() === ""
      ? null
      : { key: "search", label: search.trim(), clear: () => setSearch("") },
    usage === ALL
      ? null
      : { key: "usage", label: usages[usage] ?? usage, clear: () => setUsage(ALL) },
    status === ALL
      ? null
      : { key: "status", label: unitStatuses[status] ?? status, clear: () => setStatus(ALL) },
  ].filter((chip) => chip !== null);

  return (
    <section className="space-y-4" aria-label={t("tree.title")}>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="patrimoine-search">{t("filters.search")}</Label>
          <Input
            id="patrimoine-search"
            type="search"
            className="h-11 sm:h-9"
            placeholder={t("filters.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label id="patrimoine-usage-label" htmlFor="patrimoine-usage">
            {t("filters.usage")}
          </Label>
          <Select
            items={{ [ALL]: t("filters.usageAll"), ...usages }}
            value={usage}
            onValueChange={(next) => setUsage(String(next))}
          >
            <SelectTrigger
              id="patrimoine-usage"
              aria-labelledby="patrimoine-usage-label"
              className="h-11 w-48 sm:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.usageAll")}</SelectItem>
              {Object.entries(usages).map(([key, text]) => (
                <SelectItem key={key} value={key}>
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label id="patrimoine-status-label" htmlFor="patrimoine-status">
            {t("filters.status")}
          </Label>
          <Select
            items={{ [ALL]: t("filters.statusAll"), ...unitStatuses }}
            value={status}
            onValueChange={(next) => setStatus(String(next))}
          >
            <SelectTrigger
              id="patrimoine-status"
              aria-labelledby="patrimoine-status-label"
              className="h-11 w-44 sm:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.statusAll")}</SelectItem>
              {Object.entries(unitStatuses).map(([key, text]) => (
                <SelectItem key={key} value={key}>
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <ul className="flex flex-wrap items-center gap-2" aria-label={t("filters.active")}>
            {chips.map((chip) => (
              <li key={chip.key}>
                <Badge variant="outline" className="h-7 gap-1 pr-1">
                  {chip.label}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`${t("filters.clearOne")} : ${chip.label}`}
                    onClick={chip.clear}
                  >
                    ×
                  </Button>
                </Badge>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setUsage(ALL);
              setStatus(ALL);
            }}
          >
            {t("filters.clear")}
          </Button>
        </div>
      ) : null}

      {entities.length === 0 ? (
        <EmptyState title={t("tree.title")}>{t("tree.empty")}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title={t("tree.title")}>{t("tree.noMatch")}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {filtered.map((entity) => {
            const unitCount = entity.buildings.reduce(
              (total, building) => total + building.units.length,
              0,
            );
            return (
              <li key={entity.id} className="rounded-xl border bg-card">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <Landmark className="size-5 text-primary" aria-hidden="true" />
                  <Link
                    href={`/patrimoine/sci/${entity.id}`}
                    className="font-semibold hover:underline"
                  >
                    {entity.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {t("tree.buildingCount", { count: entity.buildings.length })} ·{" "}
                    {t("tree.unitCount", { count: unitCount })}
                  </span>
                </div>

                {entity.buildings.length === 0 ? null : (
                  <ul className="border-t">
                    {entity.buildings.map((building) => {
                      const open = collapsed[building.id] !== true;
                      const occupied = building.units.filter(
                        (unit) =>
                          unit.currentUsage !== null && !VACANT_USAGES.has(unit.currentUsage),
                      ).length;
                      return (
                        <li key={building.id} className="border-b last:border-b-0">
                          <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:pl-10">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-expanded={open}
                              aria-controls={`units-${building.id}`}
                              aria-label={open ? t("tree.collapse") : t("tree.expand")}
                              onClick={() =>
                                setCollapsed((current) => ({
                                  ...current,
                                  [building.id]: open,
                                }))
                              }
                            >
                              <ChevronRight
                                className={
                                  open ? "rotate-90 transition-transform" : "transition-transform"
                                }
                                aria-hidden="true"
                              />
                            </Button>
                            <Building2
                              className="size-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <Link
                              href={`/patrimoine/immeubles/${building.id}`}
                              className="font-medium hover:underline"
                            >
                              {building.code} — {building.name}
                            </Link>
                            <span className="text-sm text-muted-foreground">
                              {building.city ?? "—"}
                            </span>
                            <Badge variant="secondary">
                              {t("tree.unitCount", { count: building.units.length })}
                            </Badge>
                            <Badge variant="outline">
                              {t("tree.occupied", { count: occupied })}
                            </Badge>
                            <Badge variant="outline">
                              {t("tree.vacant", { count: building.units.length - occupied })}
                            </Badge>
                          </div>

                          <ul id={`units-${building.id}`} hidden={!open} className="pb-2">
                            {building.units.length === 0 ? (
                              <li className="px-4 pb-2 text-sm text-muted-foreground sm:pl-20">
                                —
                              </li>
                            ) : (
                              building.units.map((unit) => (
                                <li
                                  key={unit.id}
                                  className="flex flex-wrap items-center gap-2 px-4 py-2 sm:pl-20"
                                >
                                  <DoorClosed
                                    className="size-4 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                  <Link
                                    href={`/patrimoine/lots/${unit.id}`}
                                    className="hover:underline"
                                  >
                                    {unit.code} — {unit.label}
                                  </Link>
                                  <span className="text-sm text-muted-foreground">
                                    {kinds[unit.kind] ?? unit.kind}
                                  </span>
                                  <Badge
                                    variant={
                                      unit.currentUsage && !VACANT_USAGES.has(unit.currentUsage)
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {unit.currentUsage
                                      ? (usages[unit.currentUsage] ?? unit.currentUsage)
                                      : usages.unknown}
                                  </Badge>
                                </li>
                              ))
                            )}
                          </ul>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
