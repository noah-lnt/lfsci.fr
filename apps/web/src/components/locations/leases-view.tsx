"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Users, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeaseListItem } from "@/lib/contracts/locations";
import { errorPayload, rpc } from "@/lib/rpc";
import { LeaseStatusBadge, SelectField } from "./ui";

const STATUSES = [
  "draft",
  "ready_to_sign",
  "signed",
  "active",
  "terminated",
  "archived",
  "cancelled",
  "disputed",
] as const;

export function LeasesView() {
  const t = useTranslations("locations");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const leases = useQuery({
    queryKey: ["locations", "leases", status, search],
    queryFn: () =>
      rpc.locations.leases.list({
        limit: 50,
        ...(status ? { status: status as LeaseListItem["status"] } : {}),
        ...(search ? { search } : {}),
      }),
  });

  const hasFilter = status !== "" || search !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-48 flex-1">
          <SelectField
            id="lease-status"
            label={t("filters.status")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t("filters.all") },
              ...STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
            ]}
          />
        </div>
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="lease-search">{t("filters.search")}</Label>
          <Input
            id="lease-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-0.5">
          {status ? <Badge variant="secondary">{t(`status.${status}`)}</Badge> : null}
          {search ? <Badge variant="secondary">{search}</Badge> : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasFilter}
            onClick={() => {
              setStatus("");
              setSearch("");
            }}
          >
            <X aria-hidden="true" />
            {t("filters.clear")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href="/locations/baux/nouveau">
          <Plus aria-hidden="true" />
          {t("newLease")}
        </LinkButton>
        <LinkButton href="/locations/locataires" variant="outline">
          <Users aria-hidden="true" />
          {t("tenantsLink")}
        </LinkButton>
      </div>

      {leases.error ? <ErrorBox error={errorPayload(leases.error)} /> : null}

      {leases.isPending ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}

      {leases.data && leases.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty.leases")}</EmptyState>
      ) : null}

      {leases.data && leases.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.reference")}</TableHead>
                <TableHead>{t("columns.unit")}</TableHead>
                <TableHead>{t("columns.tenant")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.rent")}</TableHead>
                <TableHead>{t("columns.nextDue")}</TableHead>
                <TableHead>{t("columns.arrears")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leases.data.items.map((lease) => (
                <TableRow key={lease.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/locations/baux/${lease.id}`}
                    >
                      {lease.reference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {lease.unitLabel ? (
                      <span>
                        {lease.unitLabel}
                        {lease.buildingName ? ` · ${lease.buildingName}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {lease.tenants.length > 0 ? (
                      lease.tenants.join(", ")
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <LeaseStatusBadge status={lease.status} />
                  </TableCell>
                  <TableCell>
                    <Money amount={lease.rentExclCharges} currency={lease.currency} />
                  </TableCell>
                  <TableCell>
                    <DateValue value={lease.nextDueOn} />
                  </TableCell>
                  <TableCell>
                    <Money amount={lease.arrears} currency={lease.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
