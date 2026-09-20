"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorPayload, rpc } from "@/lib/rpc";
import { Field, SectionTitle } from "./ui";

export function TenantsView() {
  const t = useTranslations("locations");
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const persons = useQuery({
    queryKey: ["locations", "persons", search],
    queryFn: () => rpc.locations.persons.list({ limit: 100, ...(search ? { search } : {}) }),
  });

  const create = useMutation({
    mutationFn: () =>
      rpc.locations.persons.create({
        kind: "natural",
        displayName,
        ...(email
          ? { contactPoints: [{ kind: "email" as const, value: email, isPrimary: true }] }
          : {}),
      }),
    onSuccess: async () => {
      toast.success(t("tenant.created"));
      setDisplayName("");
      setEmail("");
      await client.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="tenant-search">{t("filters.search")}</Label>
          <Input
            id="tenant-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("tenant.newTenant")}</SectionTitle>
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!displayName) {
              setError(t("form.required"));
              return;
            }
            setError(undefined);
            create.mutate();
          }}
        >
          <Field id="new-tenant-name" label={t("form.displayName")} error={error}>
            <Input
              id="new-tenant-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field id="new-tenant-email" label={t("form.email")}>
            <Input
              id="new-tenant-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              <UserPlus aria-hidden="true" />
              {t("tenant.create")}
            </Button>
          </div>
        </form>
        {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}
      </section>

      {persons.error ? <ErrorBox error={errorPayload(persons.error)} /> : null}

      {persons.data && persons.data.items.length === 0 ? (
        <EmptyState title={t("tenantsTitle")}>{t("empty.tenants")}</EmptyState>
      ) : null}

      {persons.data && persons.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.email")}</TableHead>
                <TableHead>{t("columns.phone")}</TableHead>
                <TableHead>{t("columns.leases")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {persons.data.items.map((person) => (
                <TableRow key={person.id}>
                  <TableCell>
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/locations/locataires/${person.id}`}
                    >
                      {person.displayName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {person.email ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {person.phone ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{person.leaseCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export function TenantDetailView({ personId }: { personId: string }) {
  const t = useTranslations("locations");
  const person = useQuery({
    queryKey: ["locations", "person", personId],
    queryFn: () => rpc.locations.persons.get({ id: personId }),
  });

  if (person.error) return <ErrorBox error={errorPayload(person.error)} />;
  if (!person.data) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  const data = person.data;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <SectionTitle>{t("tenant.contactPoints")}</SectionTitle>
        {data.contactPoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.contactPoints.map((point) => (
              <li key={point.id}>
                {point.value}{" "}
                <span className="text-muted-foreground">
                  · {point.kind}
                  {point.isPrimary ? ` · ${t("tenant.primary")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <SectionTitle>{t("tenant.balance")}</SectionTitle>
        <Money amount={data.balance} />
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <SectionTitle>{t("tenant.leases")}</SectionTitle>
        {data.leases.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.leases.map((lease) => (
              <li key={lease.id}>
                <Link
                  className="underline-offset-4 hover:underline"
                  href={`/locations/baux/${lease.id}`}
                >
                  {lease.reference}
                </Link>
                <span className="text-muted-foreground"> · {t(`status.${lease.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
