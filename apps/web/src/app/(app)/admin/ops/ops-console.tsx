"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OpsSearchResult } from "@/lib/contracts/ops";
import { errorPayload, rpc } from "@/lib/rpc";

const EMPTY = "—";

function Section({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: (string | null)[][];
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base leading-snug font-medium">{title}</h2>
      </CardHeader>
      <CardContent>
        <Table>
          <caption className="sr-only">{title}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                {columns.map((column) => (
                  <TableCell key={column} className="text-muted-foreground">
                    {EMPTY}
                  </TableCell>
                ))}
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.join("|")}>
                  {row.map((cell, index) => (
                    <TableCell key={`${columns[index] ?? index}`} className="num">
                      {cell ?? EMPTY}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SearchResults({ result }: { result: OpsSearchResult }) {
  const t = useTranslations("ops");
  const columns = t.raw("columns") as Record<string, string>;

  return (
    <div className="space-y-4">
      <Section
        title={t("commands")}
        columns={[
          columns.id ?? "",
          columns.kind ?? "",
          columns.state ?? "",
          columns.createdAt ?? "",
        ]}
        rows={result.commands.map((row) => [row.id, row.commandType, row.status, row.createdAt])}
      />
      <Section
        title={t("attempts")}
        columns={[
          columns.id ?? "",
          columns.step ?? "",
          columns.outcome ?? "",
          columns.httpStatus ?? "",
        ]}
        rows={result.attempts.map((row) => [
          row.id,
          row.step,
          row.outcome,
          row.httpStatus === null ? null : String(row.httpStatus),
        ])}
      />
      <Section
        title={t("exchanges")}
        columns={[
          columns.integration ?? "",
          columns.operation ?? "",
          columns.state ?? "",
          columns.duration ?? "",
        ]}
        rows={result.exchanges.map((row) => [
          row.integration,
          row.operation,
          row.status,
          row.durationMs === null ? null : `${row.durationMs} ms`,
        ])}
      />
      {result.queueAvailable ? (
        <Section
          title={t("jobs")}
          columns={[
            columns.id ?? "",
            columns.name ?? "",
            columns.state ?? "",
            columns.createdAt ?? "",
          ]}
          rows={result.jobs.map((row) => [row.id, row.name, row.state, row.createdOn])}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("queueUnavailable")}</p>
      )}
    </div>
  );
}

function QueuesAndIntegrations() {
  const t = useTranslations("ops");
  const columns = t.raw("columns") as Record<string, string>;

  const queues = useQuery({ queryKey: ["ops", "queues"], queryFn: () => rpc.ops.queues() });
  const integrations = useQuery({
    queryKey: ["ops", "integrations"],
    queryFn: () => rpc.ops.integrations(),
  });

  return (
    <div className="space-y-4">
      {queues.data && !queues.data.available ? (
        <p className="text-sm text-muted-foreground">{t("queueUnavailable")}</p>
      ) : null}
      <Section
        title={t("queues")}
        columns={[columns.name ?? "", columns.state ?? "", columns.count ?? ""]}
        rows={(queues.data?.queues ?? []).map((row) => [row.name, row.state, String(row.count)])}
      />
      <Section
        title={t("outbox")}
        columns={[columns.state ?? "", columns.count ?? ""]}
        rows={(queues.data?.outbox ?? []).map((row) => [row.status, String(row.count)])}
      />
      <Section
        title={t("commands")}
        columns={[columns.state ?? "", columns.count ?? ""]}
        rows={(queues.data?.commands ?? []).map((row) => [row.status, String(row.count)])}
      />
      <Section
        title={t("integrations")}
        columns={[
          columns.name ?? "",
          columns.health ?? "",
          columns.lastSuccess ?? "",
          columns.failures ?? "",
        ]}
        rows={(integrations.data?.integrations ?? []).map((row) => [
          `${row.connector}/${row.stream}`,
          row.health,
          row.lastSuccessAt,
          String(row.consecutiveFailures),
        ])}
      />
    </div>
  );
}

export function OpsConsole() {
  const t = useTranslations("ops");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<OpsSearchResult | null>(null);

  const search = useMutation({
    mutationFn: (requestId: string) => rpc.ops.search({ requestId }),
    onSuccess: setResult,
  });
  const echo = useMutation({ mutationFn: () => rpc.ops.echo({}) });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="font-heading text-base leading-snug font-medium">{t("searchTitle")}</h2>
          <CardDescription>{t("searchHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              search.mutate(reference.trim());
            }}
          >
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="ops-reference">{t("searchLabel")}</Label>
              <Input
                id="ops-reference"
                name="reference"
                className="num"
                placeholder="0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </div>
            <Button type="submit" size="lg" disabled={search.isPending}>
              {t("searchAction")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={echo.isPending}
              onClick={() =>
                echo.mutate(undefined, { onSuccess: (data) => setReference(data.requestId) })
              }
            >
              ping
            </Button>
          </form>

          {search.error ? <ErrorBox error={errorPayload(search.error)} /> : null}
          {echo.data ? (
            <p className="text-xs text-muted-foreground">
              <span data-testid="ops-returned" className="num">
                {echo.data.requestId}
              </span>{" "}
              · <DateValue value={echo.data.receivedAt} withTime />
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? <SearchResults result={result} /> : null}
      <QueuesAndIntegrations />
    </div>
  );
}
