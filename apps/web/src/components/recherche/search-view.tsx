"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import type { SearchSourceKind } from "@/lib/contracts/recherche";
import { errorPayload, rpc } from "@/lib/rpc";
import { CoveragePanel } from "./coverage-panel";
import { Highlight } from "./highlight";

const KINDS: SearchSourceKind[] = ["document", "activity", "event", "intervention"];
const MIN_QUERY = 2;

export function SearchView() {
  const t = useTranslations("recherche");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<SearchSourceKind[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const trimmed = query.trim();
  const enabled = trimmed.length >= MIN_QUERY;

  const results = useQuery({
    queryKey: ["recherche", "search", trimmed, kinds, from, to],
    enabled,
    queryFn: () =>
      rpc.recherche.search({
        query: trimmed,
        limit: 20,
        ...(kinds.length > 0 ? { kinds } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
  });

  function toggleKind(kind: SearchSourceKind, checked: boolean): void {
    setKinds((current) =>
      checked ? [...current, kind] : current.filter((entry) => entry !== kind),
    );
  }

  function clearFilters(): void {
    setKinds([]);
    setFrom("");
    setTo("");
  }

  const items = results.data?.items ?? [];
  const semantic = results.data?.semantic;

  return (
    <div className="space-y-4">
      <CoveragePanel />

      <form
        className="space-y-4 rounded-xl border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft);
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="recherche-query">{t("queryLabel")}</Label>
            <Input
              id="recherche-query"
              type="search"
              className="h-11 sm:h-9"
              placeholder={t("queryPlaceholder")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recherche-from">{t("filters.from")}</Label>
            <Input
              id="recherche-from"
              type="date"
              className="h-11 sm:h-9"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recherche-to">{t("filters.to")}</Label>
            <Input
              id="recherche-to"
              type="date"
              className="h-11 sm:h-9"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <Button type="submit" className="h-11 sm:h-9">
            {t("submit")}
          </Button>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("filters.kinds")}</legend>
          <div className="flex flex-wrap gap-4">
            {KINDS.map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <Checkbox
                  id={`recherche-kind-${kind}`}
                  checked={kinds.includes(kind)}
                  onCheckedChange={(checked) => toggleKind(kind, checked === true)}
                />
                <Label htmlFor={`recherche-kind-${kind}`}>{t(`kind.${kind}`)}</Label>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {kinds.length === 0 ? t("filters.allKinds") : null}
          </p>
        </fieldset>

        {kinds.length > 0 || from || to ? (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            {t("filters.clear")}
          </Button>
        ) : null}
      </form>

      {results.error ? <ErrorBox error={errorPayload(results.error)} /> : null}

      {!enabled ? (
        <p className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          {t("prompt")}
        </p>
      ) : results.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <section aria-labelledby="recherche-results-title" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="recherche-results-title" className="text-sm font-medium">
              {t("resultsTitle")}
            </h2>
            <span className="text-sm text-muted-foreground">
              {t("resultsCount", { count: items.length })}
            </span>
          </div>

          {semantic && !semantic.used ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("semantic.off")} {semantic.reason ? t(`semantic.reason.${semantic.reason}`) : null}
            </p>
          ) : null}

          {items.length === 0 ? (
            <div
              className="rounded-xl border border-dashed bg-card p-8 text-center"
              data-testid="recherche-empty"
            >
              <h3 className="text-sm font-medium">{t("empty")}</h3>
              <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
                {t("emptyHint")}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((hit) => (
                <li
                  key={hit.id}
                  data-testid="recherche-result"
                  className="rounded-xl border bg-card p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">{t(`kind.${hit.sourceKind}`)}</Badge>
                    <Badge variant={hit.matchedOn === "words" ? "ghost" : "secondary"}>
                      {t(`matched.${hit.matchedOn}`)}
                    </Badge>
                    <span className="text-muted-foreground">
                      <DateValue value={hit.occurredAt} />
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      {t("indexedAt")} <DateValue value={hit.indexedAt} withTime />
                    </span>
                  </div>

                  <p className="mt-1 font-medium">{hit.title ?? "—"}</p>
                  {hit.excerpt ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      <Highlight text={hit.excerpt} />
                    </p>
                  ) : null}

                  <div className="mt-2">
                    {hit.href ? (
                      <LinkButton href={hit.href} variant="outline" size="sm">
                        {t("open")}
                      </LinkButton>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("noLink")}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {results.data?.truncated ? (
            <p className="text-sm text-muted-foreground">{t("truncated")}</p>
          ) : null}
        </section>
      )}
    </div>
  );
}
