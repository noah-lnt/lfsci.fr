"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Field, SectionTitle, SelectField } from "@/components/locations/ui";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportPreview, ImportResult, ReconciliationRead } from "@/lib/contracts/courte-duree";
import { errorPayload, rpc } from "@/lib/rpc";
import { Notice } from "./ui";

export function ImportWizard() {
  const t = useTranslations("courteDuree");
  const client = useQueryClient();
  const [mappingVersion, setMappingVersion] = useState("");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");
  const [listingId, setListingId] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [declaredTotal, setDeclaredTotal] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const mappings = useQuery({
    queryKey: ["courte-duree", "mappings"],
    queryFn: () => rpc.courteDuree.imports.mappings({}),
  });
  const lookups = useQuery({
    queryKey: ["courte-duree", "lookups"],
    queryFn: () => rpc.courteDuree.lookups({}),
  });

  const mapping = mappings.data?.items.find((item) => item.version === mappingVersion);

  const runPreview = useMutation({
    mutationFn: () =>
      rpc.courteDuree.imports.preview({
        mappingVersion,
        content,
        ...(declaredTotal ? { declaredTotal: declaredTotal.replace(",", ".") } : {}),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
    },
  });

  const commit = useMutation({
    mutationFn: () =>
      rpc.courteDuree.imports.commit({
        mappingVersion,
        content,
        ...(listingId ? { listingId } : {}),
        ...(legalEntityId ? { legalEntityId } : {}),
        ...(declaredTotal ? { declaredTotal: declaredTotal.replace(",", ".") } : {}),
      }),
    onSuccess: async (data) => {
      setResult(data);
      toast.success(t("import.imported"));
      await client.invalidateQueries({ queryKey: ["courte-duree"] });
    },
  });

  const listings = lookups.data?.listings ?? [];
  const legalEntities = lookups.data?.legalEntities ?? [];
  const needsListing = mapping?.kind === "bookings";
  const commitDisabled =
    preview === null ||
    preview.blocked ||
    preview.newCount === 0 ||
    (needsListing && listingId === "") ||
    (preview.payouts.length > 0 && legalEntityId === "") ||
    commit.isPending;

  return (
    <div className="space-y-6">
      <Notice title={t("import.mapping")}>{t("import.mappingHint")}</Notice>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("import.step1")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="import-mapping"
            label={t("import.mapping")}
            value={mappingVersion}
            onChange={(value) => {
              setMappingVersion(value);
              setPreview(null);
              setResult(null);
            }}
            options={(mappings.data?.items ?? []).map((item) => ({
              value: item.version,
              label: `${item.label} · ${t(`import.kinds.${item.kind}`)}`,
            }))}
          />
          <Field id="import-file" label={t("import.file")} hint={t("import.fileHint")}>
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                setPreview(null);
                setResult(null);
                if (!file) {
                  setFileName("");
                  setContent("");
                  return;
                }
                setFileName(file.name);
                setContent(await file.text());
              }}
            />
          </Field>
          <SelectField
            id="import-listing"
            label={t("import.listing")}
            value={listingId}
            onChange={setListingId}
            options={listings.map((listing) => ({ value: listing.id, label: listing.label }))}
            disabled={!needsListing}
            hint={needsListing ? undefined : t("import.needListing")}
          />
          <SelectField
            id="import-legal-entity"
            label={t("import.legalEntity")}
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={legalEntities.map((entity) => ({ value: entity.id, label: entity.label }))}
          />
          <Field
            id="import-declared-total"
            label={t("import.declaredTotal")}
            hint={t("import.declaredTotalHint")}
          >
            <Input
              id="import-declared-total"
              inputMode="decimal"
              className="num"
              value={declaredTotal}
              onChange={(event) => setDeclaredTotal(event.target.value)}
            />
          </Field>
        </div>
        {fileName ? <p className="text-sm text-muted-foreground">{fileName}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="import-preview"
            disabled={runPreview.isPending}
            onClick={() => {
              if (!mappingVersion || content === "") {
                setError(t("import.noFile"));
                return;
              }
              setError(undefined);
              runPreview.mutate();
            }}
          >
            <FileCheck2 aria-hidden="true" />
            {t("import.preview")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPreview(null);
              setResult(null);
              setContent("");
              setFileName("");
              setDeclaredTotal("");
            }}
          >
            {t("import.reset")}
          </Button>
        </div>
        {runPreview.error ? <ErrorBox error={errorPayload(runPreview.error)} /> : null}
      </section>

      {preview ? (
        <section
          className="space-y-4 rounded-xl border bg-card p-4"
          data-testid="import-preview-panel"
        >
          <SectionTitle>{t("import.previewTitle")}</SectionTitle>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
            <dt className="text-muted-foreground">{t("import.delimiter")}</dt>
            <dd className="num">{preview.delimiter === "\t" ? "\\t" : preview.delimiter}</dd>
            <dt className="text-muted-foreground">{t("import.rowCount")}</dt>
            <dd className="num" data-testid="import-row-count">
              {preview.rowCount}
            </dd>
            <dt className="text-muted-foreground">{t("import.newCount")}</dt>
            <dd className="num" data-testid="import-new-count">
              {preview.newCount}
            </dd>
            <dt className="text-muted-foreground">{t("import.duplicateCount")}</dt>
            <dd className="num" data-testid="import-duplicate-count">
              {preview.duplicateCount}
            </dd>
            <dt className="text-muted-foreground">{t("import.columnsMapped")}</dt>
            <dd>{preview.mappedColumns.map((column) => column.header).join(", ") || t("empty")}</dd>
            <dt className="text-muted-foreground">{t("import.columnsMissing")}</dt>
            <dd data-testid="import-missing-columns">
              {preview.missingColumns.join(", ") || t("empty")}
            </dd>
            <dt className="text-muted-foreground">{t("import.columnsUnknown")}</dt>
            <dd>{preview.unknownColumns.join(", ") || t("empty")}</dd>
            <dt className="text-muted-foreground">{t("import.computed")}</dt>
            <dd>
              <Money amount={preview.totals.computed} />
            </dd>
            <dt className="text-muted-foreground">{t("import.declared")}</dt>
            <dd>
              <Money amount={preview.totals.declared} />
            </dd>
            <dt className="text-muted-foreground">{t("import.difference")}</dt>
            <dd data-testid="import-total-difference">
              <Money amount={preview.totals.difference} />
            </dd>
          </dl>

          {preview.blocked ? (
            <div
              role="alert"
              className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
              data-testid="import-blocked"
            >
              <p className="font-medium">{t("import.blocked")}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {preview.blockedReasons.map((reason) => (
                  <li key={reason}>{t(`import.blockedReason.${reason}`)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.issues.length > 0 ? (
            <div className="space-y-2">
              <SectionTitle>{t("import.issues")}</SectionTitle>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {preview.issues.map((issue) => (
                  <li key={`${issue.line}-${issue.field ?? ""}-${issue.message}`}>
                    {t("import.issueLine", { line: issue.line })} · {issue.field ?? ""}{" "}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("bookings.columns.reference")}</TableHead>
                    <TableHead>{t("bookings.columns.stay")}</TableHead>
                    <TableHead>{t("bookings.columns.nights")}</TableHead>
                    <TableHead>{t("bookings.columns.guest")}</TableHead>
                    <TableHead>{t("bookings.columns.net")}</TableHead>
                    <TableHead>{t("import.duplicate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={`${row.line}-${row.reference}`} data-testid="import-row">
                      <TableCell>{row.reference}</TableCell>
                      <TableCell>
                        {row.checkInOn ? (
                          <>
                            <DateValue value={row.checkInOn} /> →{" "}
                            <DateValue value={row.checkOutOn} />
                          </>
                        ) : (
                          t("empty")
                        )}
                      </TableCell>
                      <TableCell className="num">{row.nights ?? t("empty")}</TableCell>
                      <TableCell>{row.guestName ?? t("empty")}</TableCell>
                      <TableCell>
                        <Money amount={row.net} />
                      </TableCell>
                      <TableCell>
                        {row.duplicateReason
                          ? t(`import.duplicateReason.${row.duplicateReason}`)
                          : t("empty")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {preview.payouts.map((reconciliation) => (
            <ReconciliationPanel
              key={reconciliation.externalPayoutId ?? reconciliation.paidOn}
              reconciliation={reconciliation}
            />
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              data-testid="import-commit"
              disabled={commitDisabled}
              onClick={() => commit.mutate()}
            >
              <Upload aria-hidden="true" />
              {t("import.commit")}
            </Button>
            {preview.newCount === 0 && !preview.blocked ? (
              <p className="text-sm text-muted-foreground" data-testid="import-nothing">
                {t("import.nothingToWrite")}
              </p>
            ) : null}
            {needsListing && listingId === "" ? (
              <p className="text-sm text-muted-foreground">{t("import.needListing")}</p>
            ) : null}
            {preview.payouts.length > 0 && legalEntityId === "" ? (
              <p className="text-sm text-muted-foreground">{t("import.needLegalEntity")}</p>
            ) : null}
          </div>
          {commit.error ? <ErrorBox error={errorPayload(commit.error)} /> : null}
        </section>
      ) : null}

      {result ? (
        <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="import-result">
          <SectionTitle>{t("import.step3")}</SectionTitle>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
            <dt className="text-muted-foreground">{t("import.result.bookings")}</dt>
            <dd className="num" data-testid="result-bookings">
              {result.bookingsCreated}
            </dd>
            <dt className="text-muted-foreground">{t("import.result.payouts")}</dt>
            <dd className="num">{result.payoutsCreated}</dd>
            <dt className="text-muted-foreground">{t("import.result.movements")}</dt>
            <dd className="num">{result.movementsCreated}</dd>
            <dt className="text-muted-foreground">{t("import.result.details")}</dt>
            <dd className="num">{result.detailsCreated}</dd>
            <dt className="text-muted-foreground">{t("import.result.skipped")}</dt>
            <dd className="num" data-testid="result-skipped">
              {result.skippedDuplicates}
            </dd>
            <dt className="text-muted-foreground">{t("import.result.variance")}</dt>
            <dd className="num">{result.varianceCount}</dd>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

export function ReconciliationPanel({ reconciliation }: { reconciliation: ReconciliationRead }) {
  const t = useTranslations("courteDuree.payouts.reconciliation");

  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="reconciliation">
      <SectionTitle>
        {t("title")}
        {reconciliation.externalPayoutId ? ` · ${reconciliation.externalPayoutId}` : ""}
      </SectionTitle>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
        <dt className="text-muted-foreground">{t("gross")}</dt>
        <dd>
          <Money amount={reconciliation.grossServices} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("refunds")}</dt>
        <dd>
          <Money amount={reconciliation.refunds} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("commissions")}</dt>
        <dd>
          <Money amount={reconciliation.commissions} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("taxCollected")}</dt>
        <dd>
          <Money amount={reconciliation.taxCollected} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("taxRemitted")}</dt>
        <dd>
          <Money amount={reconciliation.taxRemitted} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("revenue")}</dt>
        <dd>
          <Money amount={reconciliation.revenueRecognised} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("bookingNet")}</dt>
        <dd>
          <Money amount={reconciliation.bookingNet} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("adjustments")}</dt>
        <dd>
          <Money amount={reconciliation.adjustmentTotal} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("expected")}</dt>
        <dd data-testid="reconciliation-expected">
          <Money amount={reconciliation.expectedNet} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("declared")}</dt>
        <dd>
          <Money amount={reconciliation.declaredNet} currency={reconciliation.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("difference")}</dt>
        <dd data-testid="reconciliation-difference">
          <Money amount={reconciliation.difference} currency={reconciliation.currency} />
        </dd>
      </dl>

      <p className="text-sm" data-testid="reconciliation-verdict">
        {reconciliation.matched ? t("matched") : t("unmatched")}
      </p>

      {reconciliation.lines.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("lines")}</TableHead>
                <TableHead>{t("gross")}</TableHead>
                <TableHead>{t("refunds")}</TableHead>
                <TableHead>{t("commissions")}</TableHead>
                <TableHead>{t("taxFlow")}</TableHead>
                <TableHead>{t("bookingNet")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliation.lines.map((line) => (
                <TableRow key={line.reference} data-testid="reconciliation-line">
                  <TableCell>{line.reference}</TableCell>
                  <TableCell>
                    <Money amount={line.grossServices} currency={reconciliation.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.refunds} currency={reconciliation.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.commission} currency={reconciliation.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.taxFlow} currency={reconciliation.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={line.net} currency={reconciliation.currency} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {reconciliation.adjustments.length > 0 ? (
        <ul className="space-y-1 text-sm" data-testid="reconciliation-adjustments">
          {reconciliation.adjustments.map((adjustment) => (
            <li key={adjustment.reference}>
              {t(`adjustmentKind.${adjustment.kind}`)} · {adjustment.label ?? adjustment.reference}{" "}
              · <Money amount={adjustment.amount} currency={reconciliation.currency} />
            </li>
          ))}
        </ul>
      ) : null}

      {reconciliation.unexplained.length > 0 ? (
        <div className="space-y-1" data-testid="reconciliation-unexplained">
          <SectionTitle>{t("unexplained")}</SectionTitle>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {reconciliation.unexplained.map((entry) => (
              <li key={entry.reference}>
                {entry.reference} · {t("unknownBooking")} ·{" "}
                <Money amount={entry.amount} currency={reconciliation.currency} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </section>
  );
}
