"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateValue, formatDate } from "@/components/ui/date";
import { formatMoney, Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rpc } from "@/lib/rpc";
import { useChartTheme } from "./chart-theme";
import { ScrollRegion } from "./scroll-region";

type Horizon = "30" | "90" | "365";

type TooltipItem = { value?: number | string | (number | string)[]; payload?: { on?: string } };

function ForecastTooltip({
  active,
  payload,
  surface,
  border,
  label,
}: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  surface: string;
  border: string;
  label?: string;
}) {
  const t = useTranslations("finance.forecast");
  const point = payload?.[0];
  if (!active || !point) return null;
  const value = Array.isArray(point.value) ? point.value[0] : point.value;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: surface, borderColor: border }}
    >
      <p className="font-medium">{label ? formatDate(label) : ""}</p>
      <p className="num mt-1 font-semibold">
        {t("balance")} : {formatMoney(String(value ?? 0))}
      </p>
    </div>
  );
}

export function ForecastChart() {
  const t = useTranslations("finance.forecast");
  const [horizon, setHorizon] = useState<Horizon>("30");
  const [showTable, setShowTable] = useState(false);
  const theme = useChartTheme();
  const gradientId = useId();
  const tableId = useId();

  const forecast = useQuery({
    queryKey: ["finance", "forecast", horizon],
    queryFn: () => rpc.finance.forecast({ horizonDays: horizon }),
  });

  const data = forecast.data;
  const points = (data?.buckets ?? []).map((bucket) => ({
    on: bucket.on,
    balance: Number(bucket.balance),
    inflow: Number(bucket.inflow),
    outflow: Number(bucket.outflow),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {(["30", "90", "365"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={horizon === value ? "default" : "outline"}
              aria-pressed={horizon === value}
              onClick={() => setHorizon(value)}
            >
              {t(`horizon${value}` as "horizon30" | "horizon90" | "horizon365")}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {forecast.isPending ? <Skeleton className="h-64 w-full" /> : null}

        {data ? (
          <>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">{t("opening")}</dt>
              <dd>
                <Money amount={data.openingBalance} currency={data.currency} />
              </dd>
              <dt className="text-muted-foreground">{t("closing")}</dt>
              <dd data-testid="forecast-closing">
                <Money amount={data.closingBalance} currency={data.currency} />
              </dd>
            </dl>

            {points.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              <div className="h-64 w-full sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={theme.series} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={theme.series} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={theme.grid}
                      strokeOpacity={0.5}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="on"
                      tick={{ fontSize: 11, fill: theme.axis }}
                      tickLine={false}
                      axisLine={{ stroke: theme.grid, strokeOpacity: 0.5 }}
                      interval="preserveStartEnd"
                      tickFormatter={(value: string) => formatDate(value)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: theme.axis }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(value: number) =>
                        new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(value)
                      }
                    />
                    <RechartsTooltip
                      content={<ForecastTooltip surface={theme.surface} border={theme.border} />}
                      wrapperStyle={{ zIndex: 50 }}
                    />
                    <Area
                      type="natural"
                      dataKey="balance"
                      stroke={theme.series}
                      strokeWidth={2}
                      fill={`url(#${gradientId})`}
                      name={t("balance")}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <li>{t("legend.realised")}</li>
              <li>{t("legend.planned")}</li>
              <li>{t("legend.committed")}</li>
            </ul>

            {data.missingSources.length > 0 ? (
              <p className="text-xs text-warning">
                {t("missing")} {data.missingSources.join(", ")}
              </p>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              aria-expanded={showTable}
              aria-controls={tableId}
              onClick={() => setShowTable((open) => !open)}
            >
              {showTable ? t("hideTable") : t("showTable")}
            </Button>

            <ScrollRegion
              id={tableId}
              label={t("tableCaption")}
              className={showTable ? "" : "hidden"}
            >
              <Table>
                <caption className="sr-only">{t("tableCaption")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("date")}</TableHead>
                    <TableHead scope="col">{t("inflow")}</TableHead>
                    <TableHead scope="col">{t("outflow")}</TableHead>
                    <TableHead scope="col">{t("balance")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.buckets.map((bucket) => (
                    <TableRow key={bucket.on}>
                      <TableCell>
                        <DateValue value={bucket.on} />
                      </TableCell>
                      <TableCell>
                        <Money amount={bucket.inflow} currency={data.currency} />
                      </TableCell>
                      <TableCell>
                        <Money amount={bucket.outflow} currency={data.currency} />
                      </TableCell>
                      <TableCell>
                        <Money amount={bucket.balance} currency={data.currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
