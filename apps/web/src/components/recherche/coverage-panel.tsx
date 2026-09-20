"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { DateValue } from "@/components/ui/date";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SourceCoverage } from "@/lib/contracts/recherche";
import { errorPayload, rpc } from "@/lib/rpc";

function healthKey(source: SourceCoverage): string {
  return source.health ?? "unknown";
}

export function CoveragePanel() {
  const t = useTranslations("recherche");
  const coverage = useQuery({
    queryKey: ["recherche", "coverage"],
    queryFn: () => rpc.recherche.coverage(),
  });

  if (coverage.error) return <ErrorBox error={errorPayload(coverage.error)} />;
  if (coverage.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;

  const data = coverage.data;
  const notEmbedded = data.indexed - data.embedded;

  return (
    <section
      aria-labelledby="recherche-coverage-title"
      className="space-y-3 rounded-xl border bg-card p-4"
      data-testid="recherche-coverage"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="recherche-coverage-title" className="text-sm font-medium">
          {t("coverage.title")}
        </h2>
        <Badge variant={data.complete && !data.degraded ? "outline" : "destructive"}>
          {data.complete ? t("coverage.complete") : t("coverage.incomplete")}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">
        {t("coverage.summary", {
          indexed: data.indexed,
          total: data.total,
          embedded: data.embedded,
        })}
      </p>
      {notEmbedded > 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("coverage.notEmbedded", { count: notEmbedded })}
        </p>
      ) : null}
      {data.degraded ? (
        <p role="status" className="text-sm text-destructive">
          {t("coverage.degraded")}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t("coverage.freshness")} :{" "}
        {data.lastIndexedAt ? (
          <DateValue value={data.lastIndexedAt} withTime />
        ) : (
          t("coverage.never")
        )}
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("coverage.columns.kind")}</TableHead>
            <TableHead>{t("coverage.columns.indexed")}</TableHead>
            <TableHead>{t("coverage.columns.embedded")}</TableHead>
            <TableHead>{t("coverage.columns.freshness")}</TableHead>
            <TableHead>{t("coverage.columns.health")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.sources.map((source) => (
            <TableRow key={source.kind} data-testid="recherche-coverage-row">
              <TableCell>{t(`kind.${source.kind}`)}</TableCell>
              <TableCell className="num">
                {source.indexed} / {source.total}
              </TableCell>
              <TableCell className="num">{source.embedded}</TableCell>
              <TableCell>
                {source.lastIndexedAt ? (
                  <DateValue value={source.lastIndexedAt} withTime />
                ) : (
                  t("coverage.never")
                )}
              </TableCell>
              <TableCell>
                <span className={source.health === "healthy" ? "" : "text-destructive"}>
                  {t(`coverage.health.${healthKey(source)}`)}
                </span>
                {source.lastError ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {source.lastError}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
