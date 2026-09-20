"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { SelectField } from "@/components/finance/fields";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const STATUSES = [
  "reported",
  "qualified",
  "scheduled",
  "in_progress",
  "awaiting_part",
  "done",
  "reopened",
  "cancelled",
] as const;
const URGENCIES = ["low", "normal", "high", "critical"] as const;

function ProjectsTable() {
  const t = useTranslations("travaux.projects");
  const tStatus = useTranslations("travaux.status");
  const tNature = useTranslations("travaux.nature");
  const tTreatment = useTranslations("travaux.treatment");

  const projects = useQuery({
    queryKey: ["travaux", "projects"],
    queryFn: () => rpc.travaux.projects.list({ limit: 50 }),
  });

  if (projects.isError) return <ErrorBox error={errorPayload(projects.error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("treatmentNote")}</CardDescription>
      </CardHeader>
      <CardContent>
        {projects.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {projects.data && projects.data.items.length === 0 ? (
          <EmptyState title={t("title")}>{t("empty")}</EmptyState>
        ) : null}
        {projects.data && projects.data.items.length > 0 ? (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.label")}</TableHead>
                  <TableHead scope="col">{t("columns.nature")}</TableHead>
                  <TableHead scope="col">{t("columns.treatment")}</TableHead>
                  <TableHead scope="col">{t("columns.budget")}</TableHead>
                  <TableHead scope="col">{t("columns.engaged")}</TableHead>
                  <TableHead scope="col">{t("columns.invoiced")}</TableHead>
                  <TableHead scope="col">{t("columns.paid")}</TableHead>
                  <TableHead scope="col">{t("columns.remaining")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.data.items.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>{project.label}</TableCell>
                    <TableCell>{tNature(project.nature)}</TableCell>
                    <TableCell>{tTreatment(project.accountingTreatment)}</TableCell>
                    <TableCell>
                      <Money amount={project.budgetTracking.budget} currency={project.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={project.budgetTracking.engaged} currency={project.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={project.budgetTracking.invoiced} currency={project.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={project.budgetTracking.paid} currency={project.currency} />
                    </TableCell>
                    <TableCell>
                      <Money
                        amount={project.budgetTracking.remaining}
                        currency={project.currency}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tStatus(project.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InterventionsTable() {
  const t = useTranslations("travaux.interventions");
  const tStatus = useTranslations("travaux.status");
  const tUrgency = useTranslations("travaux.urgency");
  const [status, setStatus] = useState("");
  const [urgency, setUrgency] = useState("");

  const interventions = useQuery({
    queryKey: ["travaux", "interventions", status, urgency],
    queryFn: () =>
      rpc.travaux.interventions.list({
        limit: 50,
        ...(status ? { status: status as "reported" } : {}),
        ...(urgency ? { urgency: urgency as "normal" } : {}),
      }),
  });

  if (interventions.isError) return <ErrorBox error={errorPayload(interventions.error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-[14rem_14rem_auto]">
          <SelectField
            label={t("filterStatus")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t("all") },
              ...STATUSES.map((value) => ({ value, label: tStatus(value) })),
            ]}
            placeholder={t("all")}
          />
          <SelectField
            label={t("filterUrgency")}
            value={urgency}
            onChange={setUrgency}
            options={[
              { value: "", label: t("all") },
              ...URGENCIES.map((value) => ({ value, label: tUrgency(value) })),
            ]}
            placeholder={t("all")}
          />
          <div className="flex items-end">
            <Link href="/travaux/interventions/nouvelle" className={buttonVariants()}>
              {t("new")}
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {interventions.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {interventions.data && interventions.data.items.length === 0 ? (
          <EmptyState title={t("title")}>{t("empty")}</EmptyState>
        ) : null}
        {interventions.data && interventions.data.items.length > 0 ? (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.title")}</TableHead>
                  <TableHead scope="col">{t("columns.urgency")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                  <TableHead scope="col">{t("columns.reportedOn")}</TableHead>
                  <TableHead scope="col">{t("columns.completedOn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {interventions.data.items.map((intervention) => (
                  <TableRow key={intervention.id}>
                    <TableCell>
                      <Link
                        className="underline underline-offset-2"
                        href={`/travaux/interventions/${intervention.id}`}
                      >
                        {intervention.title}
                      </Link>
                    </TableCell>
                    <TableCell>{tUrgency(intervention.urgency)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tStatus(intervention.status)}</Badge>
                    </TableCell>
                    <TableCell>
                      <DateValue value={intervention.reportedOn} />
                    </TableCell>
                    <TableCell>
                      <DateValue value={intervention.completedOn} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function TravauxOverview() {
  return (
    <div className="space-y-6">
      <InterventionsTable />
      <ProjectsTable />
    </div>
  );
}
