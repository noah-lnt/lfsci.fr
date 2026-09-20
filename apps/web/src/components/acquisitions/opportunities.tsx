"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import {
  Figure,
  FigureList,
  type Option,
  SelectField,
  TextField,
} from "@/components/finance/fields";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import type { OpportunityDetail, ScenarioWithOutcome } from "@/lib/contracts/acquisitions";
import { errorPayload, rpc } from "@/lib/rpc";

const decimalInput = /^\d+([.,]\d{1,2})?$/;

function toMoney(value: string): string {
  return Number(value.replace(",", ".")).toFixed(2);
}

const STATUSES = [
  "idea",
  "studied",
  "offer_made",
  "under_promise",
  "signed",
  "converted",
  "abandoned",
] as const;

export function OpportunitiesTable() {
  const t = useTranslations("acquisitions");
  const tStatus = useTranslations("acquisitions.status");
  const opportunities = useQuery({
    queryKey: ["acquisitions", "list"],
    queryFn: () => rpc.acquisitions.list({ limit: 50 }),
  });

  if (opportunities.isError) return <ErrorBox error={errorPayload(opportunities.error)} />;
  const items = opportunities.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{t("description")}</p>
        <Link href="/finance/acquisitions/nouvelle" className={buttonVariants()}>
          {t("new")}
        </Link>
      </div>

      {opportunities.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {opportunities.data && items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {items.length > 0 ? (
        <ScrollRegion label={t("title")}>
          <Table>
            <caption className="sr-only">{t("title")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("columns.label")}</TableHead>
                <TableHead scope="col">{t("columns.city")}</TableHead>
                <TableHead scope="col">{t("columns.price")}</TableHead>
                <TableHead scope="col">{t("columns.budget")}</TableHead>
                <TableHead scope="col">{t("columns.rent")}</TableHead>
                <TableHead scope="col">{t("columns.scenarios")}</TableHead>
                <TableHead scope="col">{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((opportunity) => (
                <TableRow key={opportunity.id}>
                  <TableCell>
                    <Link
                      className="underline underline-offset-2"
                      href={`/finance/acquisitions/${opportunity.id}`}
                    >
                      {opportunity.label}
                    </Link>
                  </TableCell>
                  <TableCell>{opportunity.city ?? "—"}</TableCell>
                  <TableCell>
                    <Money amount={opportunity.askingPrice} currency={opportunity.currency} />
                  </TableCell>
                  <TableCell>
                    <Money amount={opportunity.totalBudget} currency={opportunity.currency} />
                  </TableCell>
                  <TableCell>
                    <Money
                      amount={opportunity.expectedRentYearly}
                      currency={opportunity.currency}
                    />
                  </TableCell>
                  <TableCell className="num">{opportunity.scenarioCount}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tStatus(opportunity.status)}</Badge>
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

export function OpportunityForm() {
  const t = useTranslations("acquisitions.form");
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [askingPrice, setAskingPrice] = useState("");
  const [estimatedFees, setEstimatedFees] = useState("");
  const [estimatedWorks, setEstimatedWorks] = useState("");
  const [expectedRentYearly, setExpectedRentYearly] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const entities: Option[] = (lookups.data?.legalEntities ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const create = useMutation({
    mutationFn: () =>
      rpc.acquisitions.create({
        label,
        ...(legalEntityId ? { legalEntityId } : {}),
        ...(addressLine1 ? { addressLine1 } : {}),
        ...(postalCode ? { postalCode } : {}),
        ...(city ? { city } : {}),
        ...(askingPrice ? { askingPrice: toMoney(askingPrice) } : {}),
        ...(estimatedFees ? { estimatedFees: toMoney(estimatedFees) } : {}),
        ...(estimatedWorks ? { estimatedWorks: toMoney(estimatedWorks) } : {}),
        ...(expectedRentYearly ? { expectedRentYearly: toMoney(expectedRentYearly) } : {}),
      }),
    onSuccess: (opportunity) => router.push(`/finance/acquisitions/${opportunity.id}`),
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate();
      }}
    >
      {error ? <ErrorBox error={error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label={t("label")} value={label} onChange={setLabel} />
          <SelectField
            label={t("legalEntity")}
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={entities}
            placeholder="—"
          />
          <TextField label={t("address")} value={addressLine1} onChange={setAddressLine1} />
          <TextField label={t("postalCode")} value={postalCode} onChange={setPostalCode} />
          <TextField label={t("city")} value={city} onChange={setCity} />
          <TextField
            label={t("askingPrice")}
            value={askingPrice}
            inputMode="decimal"
            onChange={setAskingPrice}
          />
          <TextField
            label={t("estimatedFees")}
            value={estimatedFees}
            inputMode="decimal"
            onChange={setEstimatedFees}
          />
          <TextField
            label={t("estimatedWorks")}
            value={estimatedWorks}
            inputMode="decimal"
            onChange={setEstimatedWorks}
          />
          <TextField
            label={t("expectedRent")}
            value={expectedRentYearly}
            inputMode="decimal"
            onChange={setExpectedRentYearly}
          />
        </CardContent>
      </Card>
      <Button type="submit" size="lg" disabled={label === "" || create.isPending}>
        {create.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

function ScenarioForm({
  opportunityId,
  scenario,
  onDone,
  onCancel,
}: {
  opportunityId: string;
  scenario: ScenarioWithOutcome | null;
  onDone: (detail: OpportunityDetail) => void;
  onCancel?: () => void;
}) {
  const t = useTranslations("acquisitions.scenarios");
  const [label, setLabel] = useState(scenario?.label ?? "");
  const [loanAmount, setLoanAmount] = useState(scenario?.loanAmount ?? "");
  const [equityAmount, setEquityAmount] = useState(scenario?.equityAmount ?? "");
  const [loanRate, setLoanRate] = useState(scenario?.loanRate ?? "");
  const [loanMonths, setLoanMonths] = useState(
    scenario === null || scenario.loanMonths === 0 ? "" : String(scenario.loanMonths),
  );
  const [chargesYearly, setChargesYearly] = useState(scenario?.chargesYearly ?? "");
  const [vacancyRate, setVacancyRate] = useState(
    scenario?.vacancyRate ? String(Number(scenario.vacancyRate) * 100) : "",
  );
  const [lender, setLender] = useState(
    typeof scenario?.assumptions.lender === "string" ? scenario.assumptions.lender : "",
  );
  const [error, setError] = useState<ErrorPayload | null>(null);

  const share = (value: string) => (Number(value.replace(",", ".")) / 100).toFixed(6);

  const submit = useMutation({
    mutationFn: () => {
      const common = {
        label,
        ...(loanAmount ? { loanAmount: toMoney(loanAmount) } : {}),
        ...(equityAmount ? { equityAmount: toMoney(equityAmount) } : {}),
        ...(loanRate ? { loanRate: Number(loanRate.replace(",", ".")).toFixed(6) } : {}),
        ...(loanMonths ? { loanMonths: Number.parseInt(loanMonths, 10) } : {}),
        ...(chargesYearly ? { chargesYearly: toMoney(chargesYearly) } : {}),
        ...(vacancyRate ? { vacancyRate: share(vacancyRate) } : {}),
        ...(lender ? { lender } : {}),
      };
      return scenario
        ? rpc.acquisitions.scenarios.update({
            id: scenario.id,
            expectedVersion: scenario.version,
            ...common,
          })
        : rpc.acquisitions.scenarios.create({ opportunityId, ...common });
    },
    onSuccess: onDone,
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        submit.mutate();
      }}
    >
      {error ? <ErrorBox error={error} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField label={t("label")} value={label} onChange={setLabel} />
        <TextField label={t("lender")} value={lender} onChange={setLender} />
        <TextField
          label={t("loanAmount")}
          value={loanAmount}
          inputMode="decimal"
          onChange={setLoanAmount}
        />
        <TextField
          label={t("equityAmount")}
          value={equityAmount}
          inputMode="decimal"
          onChange={setEquityAmount}
        />
        <TextField
          label={t("loanRate")}
          value={loanRate}
          inputMode="decimal"
          onChange={setLoanRate}
        />
        <TextField
          label={t("loanMonths")}
          value={loanMonths}
          inputMode="numeric"
          onChange={setLoanMonths}
        />
        <TextField
          label={t("chargesYearly")}
          value={chargesYearly}
          inputMode="decimal"
          onChange={setChargesYearly}
        />
        <TextField
          label={t("vacancyRate")}
          value={vacancyRate}
          inputMode="decimal"
          onChange={setVacancyRate}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={label === "" || submit.isPending}>
          {scenario ? t("save") : t("add")}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Scenarios({
  detail,
  onChanged,
}: {
  detail: OpportunityDetail;
  onChanged: (next: OpportunityDetail) => void;
}) {
  const t = useTranslations("acquisitions.scenarios");
  const [editing, setEditing] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => rpc.acquisitions.scenarios.remove({ id }),
    onSuccess: onChanged,
  });
  const edited = detail.scenarios.find((scenario) => scenario.id === editing) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {detail.scenarios.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("label")}</TableHead>
                  <TableHead scope="col">{t("budget")}</TableHead>
                  <TableHead scope="col">{t("gap")}</TableHead>
                  <TableHead scope="col">{t("installment")}</TableHead>
                  <TableHead scope="col">{t("cashflow")}</TableHead>
                  <TableHead scope="col">{t("netYield")}</TableHead>
                  <TableHead scope="col">{t("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.scenarios.map((scenario) => (
                  <TableRow key={scenario.id}>
                    <TableCell>
                      {scenario.label}
                      {scenario.isBase ? (
                        <Badge variant="default" className="ml-2">
                          {t("base")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Money amount={scenario.outcome.totalBudget} currency={scenario.currency} />
                    </TableCell>
                    <TableCell data-testid="scenario-gap">
                      <Money amount={scenario.outcome.financingGap} currency={scenario.currency} />
                    </TableCell>
                    <TableCell>
                      <Money
                        amount={scenario.outcome.monthlyInstallment}
                        currency={scenario.currency}
                      />
                    </TableCell>
                    <TableCell>
                      <Money
                        amount={scenario.outcome.monthlyCashflow}
                        currency={scenario.currency}
                      />
                    </TableCell>
                    <TableCell className="num">{scenario.outcome.netYield} %</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(scenario.id)}
                        >
                          {t("edit")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => remove.mutate(scenario.id)}
                          disabled={remove.isPending}
                        >
                          {t("remove")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
        )}

        {edited ? (
          <ScenarioForm
            key={edited.id}
            opportunityId={detail.id}
            scenario={edited}
            onDone={(next) => {
              setEditing(null);
              onChanged(next);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <ScenarioForm opportunityId={detail.id} scenario={null} onDone={onChanged} />
        )}
      </CardContent>
    </Card>
  );
}

function ConvertCard({
  detail,
  onConverted,
}: {
  detail: OpportunityDetail;
  onConverted: (next: OpportunityDetail) => void;
}) {
  const t = useTranslations("acquisitions.convert");
  const [buildingCode, setBuildingCode] = useState("");
  const [buildingName, setBuildingName] = useState(detail.label);
  const [addressLine1, setAddressLine1] = useState(detail.addressLine1 ?? "");
  const [signedOn, setSignedOn] = useState(detail.signedOn ?? "");
  const [acquisitionPrice, setAcquisitionPrice] = useState(detail.askingPrice ?? "");
  const [landValue, setLandValue] = useState("");
  const [legalEntityId, setLegalEntityId] = useState(detail.legalEntityId ?? "");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const entities: Option[] = (lookups.data?.legalEntities ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const convert = useMutation({
    mutationFn: () =>
      rpc.acquisitions.convert({
        id: detail.id,
        expectedVersion: detail.version,
        legalEntityId,
        buildingCode,
        buildingName,
        addressLine1,
        signedOn,
        acquisitionPrice: toMoney(acquisitionPrice),
        landValue: toMoney(landValue),
      }),
    onSuccess: (result) => {
      setOutcome(result.alreadyConverted ? "already" : "done");
      onConverted(result.opportunity);
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const done = detail.conversion.done;
  const complete =
    legalEntityId !== "" &&
    buildingCode !== "" &&
    buildingName !== "" &&
    addressLine1 !== "" &&
    signedOn !== "" &&
    decimalInput.test(acquisitionPrice) &&
    decimalInput.test(landValue);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{done ? t("alreadyDescription") : t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}
        {done ? (
          <ul className="space-y-1 text-sm" data-testid="conversion-result">
            <li>
              {t("building")} :{" "}
              <Link
                className="underline underline-offset-2"
                href={`/patrimoine/${detail.conversion.buildingId}`}
              >
                {detail.label}
              </Link>
            </li>
            <li>
              {t("asset")} :{" "}
              {detail.conversion.fixedAssetId ? (
                <Link
                  className="underline underline-offset-2"
                  href={`/finance/actifs/${detail.conversion.fixedAssetId}`}
                >
                  {t("assetLink")}
                </Link>
              ) : (
                "—"
              )}
            </li>
            <li>
              {t("loan")} :{" "}
              {detail.conversion.loanId ? (
                <Link
                  className="underline underline-offset-2"
                  href={`/finance/credits/${detail.conversion.loanId}`}
                >
                  {t("loanLink")}
                </Link>
              ) : (
                t("noLoan")
              )}
            </li>
            <li>
              {t("command")} : <span className="num">{detail.conversion.commandId}</span>
            </li>
          </ul>
        ) : null}

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            convert.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={t("legalEntity")}
              value={legalEntityId}
              onChange={setLegalEntityId}
              options={entities}
              placeholder="—"
              disabled={done}
            />
            <TextField label={t("buildingCode")} value={buildingCode} onChange={setBuildingCode} />
            <TextField label={t("buildingName")} value={buildingName} onChange={setBuildingName} />
            <TextField label={t("address")} value={addressLine1} onChange={setAddressLine1} />
            <TextField label={t("signedOn")} type="date" value={signedOn} onChange={setSignedOn} />
            <TextField
              label={t("price")}
              value={acquisitionPrice}
              inputMode="decimal"
              onChange={setAcquisitionPrice}
            />
            <TextField
              label={t("landValue")}
              value={landValue}
              inputMode="decimal"
              onChange={setLandValue}
              hint={t("landHint")}
            />
          </div>
          <Button type="submit" disabled={done || !complete || convert.isPending}>
            {convert.isPending ? t("submitting") : t("submit")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("levelHint")}</p>
          {outcome ? (
            <p role="status" className="text-sm" data-testid="convert-outcome">
              {outcome === "already" ? t("already") : t("converted")}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

export function OpportunityView({ id }: { id: string }) {
  const t = useTranslations("acquisitions");
  const tDetail = useTranslations("acquisitions.detail");
  const tStatus = useTranslations("acquisitions.status");
  const queryClient = useQueryClient();
  const opportunity = useQuery({
    queryKey: ["acquisitions", id],
    queryFn: () => rpc.acquisitions.get({ id }),
  });
  const [reason, setReason] = useState("");

  const onChanged = (next: OpportunityDetail) => {
    queryClient.setQueryData(["acquisitions", id], next);
    void queryClient.invalidateQueries({ queryKey: ["acquisitions", "list"] });
  };

  const archive = useMutation({
    mutationFn: () =>
      rpc.acquisitions.archive({
        id,
        expectedVersion: opportunity.data?.version as number,
        reason,
      }),
    onSuccess: onChanged,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      rpc.acquisitions.update({
        id,
        expectedVersion: opportunity.data?.version as number,
        status: status as "idea",
      }),
    onSuccess: onChanged,
  });

  if (opportunity.isError) return <ErrorBox error={errorPayload(opportunity.error)} />;
  if (!opportunity.data) return <Skeleton className="h-64 w-full" />;
  const data = opportunity.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{data.label}</CardTitle>
          <CardDescription>
            <Badge variant="secondary">{tStatus(data.status)}</Badge>
            {data.city ? ` · ${data.city}` : null}
            {data.legalEntityName ? ` · ${data.legalEntityName}` : null}
            {data.signedOn ? (
              <>
                {" · "}
                <DateValue value={data.signedOn} />
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FigureList>
            <Figure label={t("columns.price")}>
              <Money amount={data.askingPrice} currency={data.currency} />
            </Figure>
            <Figure label={tDetail("fees")}>
              <Money amount={data.estimatedFees} currency={data.currency} />
            </Figure>
            <Figure label={tDetail("works")}>
              <Money amount={data.estimatedWorks} currency={data.currency} />
            </Figure>
            <Figure label={t("columns.budget")} testId="opportunity-budget">
              <Money amount={data.totalBudget} currency={data.currency} />
            </Figure>
            <Figure label={t("columns.rent")}>
              <Money amount={data.expectedRentYearly} currency={data.currency} />
            </Figure>
            <Figure label={tDetail("documents")}>{data.documentCount}</Figure>
          </FigureList>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_2fr] sm:items-end">
            <SelectField
              label={tDetail("status")}
              value={data.status}
              onChange={(next) => setStatus.mutate(next)}
              options={STATUSES.map((value) => ({ value, label: tStatus(value) }))}
              disabled={setStatus.isPending}
            />
            <div className="flex items-end gap-2">
              <TextField
                label={tDetail("archiveReason")}
                value={reason}
                onChange={setReason}
                className="flex-1 space-y-1.5"
              />
              <Button
                type="button"
                variant="destructive"
                onClick={() => archive.mutate()}
                disabled={reason.trim() === "" || archive.isPending}
              >
                {tDetail("archive")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Scenarios detail={data} onChanged={onChanged} />
      <ConvertCard detail={data} onConverted={onChanged} />
    </div>
  );
}
