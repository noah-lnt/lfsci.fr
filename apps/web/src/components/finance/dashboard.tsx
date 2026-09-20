"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateValue } from "@/components/ui/date";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import type { FinanceKpi } from "@/lib/contracts/finance";
import { errorPayload, rpc } from "@/lib/rpc";
import { ForecastChart } from "./forecast-chart";

function KpiCard({
  title,
  kpi,
  testId,
  children,
}: {
  title: string;
  kpi: FinanceKpi | undefined;
  testId: string;
  children?: ReactNode;
}) {
  const t = useTranslations("finance.kpi");
  return (
    <Card className="relative overflow-hidden">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary/70" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {kpi ? (
          <>
            <p className="text-2xl font-bold" data-testid={testId}>
              <Money amount={kpi.amount} currency={kpi.currency} />
            </p>
            <p className="text-xs text-muted-foreground">
              {kpi.asOf ? (
                <>
                  {t("asOf")} <DateValue value={kpi.asOf} />
                  {" · "}
                </>
              ) : null}
              {kpi.source === "odoo" ? t("sourceOdoo") : t("sourceProjection")}
              {kpi.detail ? ` · ${kpi.detail}` : null}
            </p>
          </>
        ) : (
          (children ?? <Skeleton className="h-8 w-28" />)
        )}
      </CardContent>
    </Card>
  );
}

export function FinanceDashboard() {
  const t = useTranslations("finance.kpi");
  const dashboard = useQuery({
    queryKey: ["finance", "dashboard"],
    queryFn: () => rpc.finance.dashboard({}),
  });

  if (dashboard.isError) return <ErrorBox error={errorPayload(dashboard.error)} />;
  const data = dashboard.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard title={t("banks")} kpi={data?.banks} testId="kpi-banks" />
        <KpiCard title={t("treasury")} kpi={data?.treasury} testId="kpi-treasury" />
        <KpiCard title={t("debt")} kpi={data?.debt} testId="kpi-debt" />
        <KpiCard title={t("cca")} kpi={data?.cca} testId="kpi-cca" />
        <KpiCard title={t("netBookValue")} kpi={data?.netBookValue} testId="kpi-nbv" />
        <Card className="relative overflow-hidden">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary/70" />
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("nextInstallment")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data ? (
              data.nextInstallment ? (
                <>
                  <p className="text-2xl font-bold" data-testid="kpi-next">
                    <Money amount={data.nextInstallment.amount} currency={data.currency} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <DateValue value={data.nextInstallment.dueOn} /> · {data.nextInstallment.label}
                  </p>
                </>
              ) : (
                <p className="num text-2xl font-bold text-muted-foreground">—</p>
              )
            ) : (
              <Skeleton className="h-8 w-28" />
            )}
          </CardContent>
        </Card>
      </div>

      {data ? (
        <p className="text-sm text-muted-foreground">
          {t("unallocated")} : <Money amount={data.unallocatedExpenses} currency={data.currency} />
        </p>
      ) : null}

      <ForecastChart />
    </div>
  );
}
