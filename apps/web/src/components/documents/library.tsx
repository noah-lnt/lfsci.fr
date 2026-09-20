"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { DocumentPanel } from "./document-panel";

const ALL = "all";

export function DocumentLibrary() {
  const t = useTranslations("documents");
  const [search, setSearch] = useState("");
  const [nature, setNature] = useState(ALL);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const natures = t.raw("nature") as Record<string, string>;

  const chips = [
    search.trim() === ""
      ? null
      : { key: "search", label: search.trim(), clear: () => setSearch("") },
    nature === ALL
      ? null
      : { key: "nature", label: natures[nature] ?? nature, clear: () => setNature(ALL) },
    periodFrom === ""
      ? null
      : { key: "from", label: `≥ ${periodFrom}`, clear: () => setPeriodFrom("") },
    periodTo === "" ? null : { key: "to", label: `≤ ${periodTo}`, clear: () => setPeriodTo("") },
  ].filter((chip) => chip !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="documents-search">{t("filters.search")}</Label>
          <Input
            id="documents-search"
            type="search"
            className="h-11 sm:h-9"
            placeholder={t("filters.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label id="documents-nature-label" htmlFor="documents-nature">
            {t("filters.nature")}
          </Label>
          <Select
            items={{ [ALL]: t("filters.natureAll"), ...natures }}
            value={nature}
            onValueChange={(next) => setNature(String(next))}
          >
            <SelectTrigger
              id="documents-nature"
              aria-labelledby="documents-nature-label"
              className="h-11 w-48 sm:h-9"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("filters.natureAll")}</SelectItem>
              {Object.entries(natures).map(([key, text]) => (
                <SelectItem key={key} value={key}>
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="documents-from">{t("filters.periodFrom")}</Label>
          <Input
            id="documents-from"
            type="date"
            className="h-11 sm:h-9"
            value={periodFrom}
            onChange={(event) => setPeriodFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="documents-to">{t("filters.periodTo")}</Label>
          <Input
            id="documents-to"
            type="date"
            className="h-11 sm:h-9"
            value={periodTo}
            onChange={(event) => setPeriodTo(event.target.value)}
          />
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Badge key={chip.key} variant="outline" className="h-7 gap-1 pr-1">
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
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setNature(ALL);
              setPeriodFrom("");
              setPeriodTo("");
            }}
          >
            {t("filters.clear")}
          </Button>
        </div>
      ) : null}

      <DocumentPanel
        filters={{
          ...(search.trim() ? { search: search.trim() } : {}),
          ...(nature === ALL ? {} : { nature }),
          ...(periodFrom ? { periodFrom } : {}),
          ...(periodTo ? { periodTo } : {}),
        }}
      />
    </div>
  );
}
