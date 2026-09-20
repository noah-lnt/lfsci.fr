"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { SelectField, TextField } from "@/components/finance/fields";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Money } from "@/components/ui/money";
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
import { ChargesTabs } from "./charges-tabs";

const ALL_BUILDINGS = "__all__";

export function RunsView() {
  const t = useTranslations("charges.runs");
  const client = useQueryClient();
  const router = useRouter();

  const [legalEntityId, setLegalEntityId] = useState("");
  const [buildingId, setBuildingId] = useState(ALL_BUILDINGS);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const runs = useQuery({
    queryKey: ["charges", "runs"],
    queryFn: () => rpc.charges.runs.list({}),
  });
  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });

  const create = useMutation({
    mutationFn: () =>
      rpc.charges.runs.create({
        legalEntityId,
        ...(buildingId === ALL_BUILDINGS ? {} : { buildingId }),
        periodStart,
        periodEnd,
      }),
    onSuccess: async (run) => {
      toast.success(t("created"));
      await client.invalidateQueries({ queryKey: ["charges"] });
      router.push(`/finance/charges/${run.id}`);
    },
  });

  const buildings = (lookups.data?.buildings ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  return (
    <div className="space-y-6">
      <ChargesTabs />

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-tight">{t("new")}</h2>
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <SelectField
            label={t("entity")}
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={(lookups.data?.legalEntities ?? []).map((entry) => ({
              value: entry.id,
              label: entry.label,
            }))}
          />
          <SelectField
            label={t("building")}
            value={buildingId}
            onChange={setBuildingId}
            options={[{ value: ALL_BUILDINGS, label: t("buildingAll") }, ...buildings]}
          />
          <TextField
            label={t("periodStart")}
            type="date"
            value={periodStart}
            onChange={setPeriodStart}
            required
          />
          <TextField
            label={t("periodEnd")}
            type="date"
            value={periodEnd}
            onChange={setPeriodEnd}
            required
          />
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              type="submit"
              disabled={create.isPending || !legalEntityId || !periodStart || !periodEnd}
              data-testid="run-create"
            >
              {t("create")}
            </Button>
          </div>
        </form>
        {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}
      </section>

      {runs.isError ? <ErrorBox error={errorPayload(runs.error)} /> : null}
      {runs.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {runs.data && runs.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {runs.data && runs.data.items.length > 0 ? (
        <ScrollRegion label={t("title")}>
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("entity")}</TableHead>
                <TableHead scope="col">{t("building")}</TableHead>
                <TableHead scope="col">{t("period")}</TableHead>
                <TableHead scope="col">{t("totalRecoverable")}</TableHead>
                <TableHead scope="col">{t("totalProvisionsCalled")}</TableHead>
                <TableHead scope="col">{t("status")}</TableHead>
                <TableHead scope="col">{t("frozenAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.items.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      className="underline underline-offset-2"
                      href={`/finance/charges/${run.id}`}
                    >
                      {run.legalEntityName}
                    </Link>
                  </TableCell>
                  <TableCell>{run.buildingName ?? t("buildingAll")}</TableCell>
                  <TableCell className="num">
                    <DateValue value={run.periodStart} /> — <DateValue value={run.periodEnd} />
                  </TableCell>
                  <TableCell>
                    <Money amount={run.totalRecoverable} currency={run.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={run.totalProvisionsCalled} currency={run.currency} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={run.status === "cancelled" ? "outline" : "default"}>
                      {t(`statusValue.${run.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DateValue value={run.frozenAt} withTime />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      ) : null}
    </div>
  );
}
