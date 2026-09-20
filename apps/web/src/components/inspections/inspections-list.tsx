"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, PiggyBank, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { PageNav } from "@/components/layout/page-nav";
import { Field, SectionTitle, SelectField } from "@/components/locations/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { CreateInspectionInput } from "@/lib/contracts/inspections";
import { errorPayload, rpc } from "@/lib/rpc";
import { InspectionStatusBadge } from "./ui";

const KINDS = ["entry", "exit", "intermediate"] as const;

export function InspectionsList({ leaseId }: { leaseId: string }) {
  const t = useTranslations("inspections");
  const router = useRouter();
  const client = useQueryClient();

  const [kind, setKind] = useState<string>("entry");
  const [unitId, setUnitId] = useState("");
  const [performedOn, setPerformedOn] = useState(new Date().toISOString().slice(0, 10));
  const [offline, setOffline] = useState(false);

  const lease = useQuery({
    queryKey: ["locations", "lease", leaseId],
    queryFn: () => rpc.locations.leases.get({ id: leaseId }),
  });
  const inspections = useQuery({
    queryKey: ["inspections", "list", leaseId],
    queryFn: () => rpc.inspections.list({ leaseId, limit: 50 }),
  });

  const units = lease.data?.units ?? [];
  const selectedUnit = unitId || (units[0]?.unitId ?? "");

  const create = useMutation({
    mutationFn: () => {
      const input: CreateInspectionInput = {
        leaseId,
        unitId: selectedUnit,
        kind: kind as CreateInspectionInput["kind"],
        ...(performedOn ? { performedOn } : {}),
        offlineCapture: offline,
      };
      return rpc.inspections.create(input);
    },
    onSuccess: async (inspection) => {
      await client.invalidateQueries({ queryKey: ["inspections"] });
      router.push(`/locations/baux/${leaseId}/etats-des-lieux/${inspection.id}`);
    },
  });

  if (inspections.isError) return <ErrorBox error={errorPayload(inspections.error)} />;

  const items = inspections.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageNav
        title={t("title")}
        description={t("description")}
        icon={<ClipboardList className="size-5" aria-hidden="true" />}
      >
        <LinkButton href={`/locations/baux/${leaseId}`} variant="outline" size="sm">
          <ArrowLeft aria-hidden="true" />
          {t("backToLease")}
        </LinkButton>
      </PageNav>

      <div className="flex flex-wrap gap-2">
        <LinkButton
          href={`/locations/baux/${leaseId}/etats-des-lieux/comparaison`}
          variant="outline"
        >
          <Scale aria-hidden="true" />
          {t("compare")}
        </LinkButton>
        <LinkButton
          href={`/locations/baux/${leaseId}/etats-des-lieux/restitution`}
          variant="outline"
        >
          <PiggyBank aria-hidden="true" />
          {t("openSettlement")}
        </LinkButton>
      </div>

      {inspections.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {inspections.data && items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {items.length > 0 ? (
        <ScrollRegion label={t("title")} className="rounded-xl border bg-card">
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.kind")}</TableHead>
                <TableHead scope="col">{t("columns.performedOn")}</TableHead>
                <TableHead scope="col">{t("columns.unit")}</TableHead>
                <TableHead scope="col">{t("columns.status")}</TableHead>
                <TableHead scope="col">{t("columns.findings")}</TableHead>
                <TableHead scope="col">{t("columns.photos")}</TableHead>
                <TableHead scope="col">{t("columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((inspection) => (
                <TableRow key={inspection.id} data-testid="inspection-row">
                  <TableCell>{t(`kind.${inspection.kind}`)}</TableCell>
                  <TableCell>
                    <DateValue value={inspection.performedOn} />
                  </TableCell>
                  <TableCell>{inspection.unitLabel}</TableCell>
                  <TableCell>
                    <InspectionStatusBadge status={inspection.status} />
                  </TableCell>
                  <TableCell className="num">{inspection.findingCount}</TableCell>
                  <TableCell className="num">{inspection.photoCount}</TableCell>
                  <TableCell>
                    <Link
                      className="underline-offset-4 hover:underline"
                      href={`/locations/baux/${leaseId}/etats-des-lieux/${inspection.id}`}
                    >
                      {t("openCapture")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollRegion>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("create.title")}</SectionTitle>
        {units.length === 0 && lease.data ? (
          <p className="text-sm text-muted-foreground">{t("create.noUnit")}</p>
        ) : null}
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(undefined, {
              onSuccess: () => toast.success(t("capture.saved")),
            });
          }}
        >
          <SelectField
            id="inspection-kind"
            label={t("create.kind")}
            value={kind}
            onChange={setKind}
            options={KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
          />
          <SelectField
            id="inspection-unit"
            label={t("create.unit")}
            value={selectedUnit}
            onChange={setUnitId}
            disabled={units.length === 0}
            options={units.map((unit) => ({
              value: unit.unitId,
              label: `${unit.unitLabel} · ${unit.buildingName}`,
            }))}
          />
          <Field id="inspection-performed-on" label={t("create.performedOn")}>
            <Input
              id="inspection-performed-on"
              type="date"
              value={performedOn}
              onChange={(event) => setPerformedOn(event.target.value)}
            />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-3">
            <Checkbox
              id="inspection-offline"
              checked={offline}
              onCheckedChange={(checked) => setOffline(checked === true)}
            />
            <Label htmlFor="inspection-offline">{t("create.offline")}</Label>
          </div>
          <div className="sm:col-span-3">
            <Button
              type="submit"
              className="h-11 sm:h-9"
              disabled={selectedUnit === "" || create.isPending}
            >
              {t("create.submit")}
            </Button>
          </div>
        </form>
        {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}
      </section>
    </div>
  );
}
