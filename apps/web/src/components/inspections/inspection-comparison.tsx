"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { PageNav } from "@/components/layout/page-nav";
import { SectionTitle } from "@/components/locations/ui";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorPayload, rpc } from "@/lib/rpc";
import { ConditionBadge } from "./ui";

export function InspectionComparison({ leaseId }: { leaseId: string }) {
  const t = useTranslations("inspections");
  const comparison = useQuery({
    queryKey: ["inspections", "comparison", leaseId],
    queryFn: () => rpc.inspections.comparison({ leaseId }),
  });

  if (comparison.isError) return <ErrorBox error={errorPayload(comparison.error)} />;

  const data = comparison.data;

  return (
    <div className="space-y-6">
      <PageNav
        title={t("comparison.title")}
        description={t("comparison.description")}
        icon={<Scale className="size-5" aria-hidden="true" />}
      >
        <LinkButton href={`/locations/baux/${leaseId}/etats-des-lieux`} variant="outline" size="sm">
          <ArrowLeft aria-hidden="true" />
          {t("backToList")}
        </LinkButton>
      </PageNav>

      {comparison.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {data ? (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          {data.entryInspectionId === null ? (
            <p className="text-sm text-muted-foreground">{t("comparison.entryMissing")}</p>
          ) : null}
          {data.exitInspectionId === null ? (
            <p className="text-sm text-muted-foreground">{t("comparison.exitMissing")}</p>
          ) : null}
          <p className="text-sm" data-testid="comparison-proposed">
            {t("comparison.proposed", { count: data.proposedCount })}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="comparison-conformity">
            {data.exitConforms ? t("comparison.conforms") : t("comparison.notConforms")}
          </p>
        </div>
      ) : null}

      {data && data.differences.length === 0 ? (
        <EmptyState title={t("comparison.title")}>{t("comparison.empty")}</EmptyState>
      ) : null}

      {data && data.differences.length > 0 ? (
        <ScrollRegion label={t("comparison.title")} className="rounded-xl border bg-card">
          <Table>
            <caption className="sr-only">{t("comparison.title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("comparison.columns.room")}</TableHead>
                <TableHead scope="col">{t("comparison.columns.element")}</TableHead>
                <TableHead scope="col">{t("comparison.columns.entry")}</TableHead>
                <TableHead scope="col">{t("comparison.columns.exit")}</TableHead>
                <TableHead scope="col">{t("comparison.columns.status")}</TableHead>
                <TableHead scope="col">{t("comparison.columns.review")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.differences.map((difference) => (
                <TableRow
                  key={`${difference.entryFindingId ?? ""}-${difference.exitFindingId ?? ""}`}
                  data-testid="difference-row"
                >
                  <TableCell>{difference.room ?? "—"}</TableCell>
                  <TableCell>{difference.element}</TableCell>
                  <TableCell>
                    <ConditionBadge condition={difference.entryCondition} />
                  </TableCell>
                  <TableCell>
                    <ConditionBadge condition={difference.exitCondition} />
                  </TableCell>
                  <TableCell>{t(`comparison.status.${difference.status}`)}</TableCell>
                  <TableCell data-testid="difference-review">
                    <Badge variant={difference.proposedForReview ? "destructive" : "outline"}>
                      {difference.proposedForReview
                        ? t("comparison.reviewYes")
                        : t("comparison.reviewNo")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("comparison.inventoryTitle")}</SectionTitle>
        <p className="text-sm text-muted-foreground">{t("comparison.noAutomaticRetention")}</p>
        {data && data.inventory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("inventory.empty")}</p>
        ) : null}
        {data && data.inventory.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {data.inventory.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.label}</span>
                <span className="text-muted-foreground">{item.category}</span>
                <Badge variant={item.status === "missing" ? "destructive" : "outline"}>
                  {t(`comparison.inventoryStatus.${item.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
