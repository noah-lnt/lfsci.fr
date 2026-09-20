"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
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
import type { AssetComponentPosition, FixedAssetDetail } from "@/lib/contracts/finance";
import { errorPayload, rpc } from "@/lib/rpc";
import { Figure, FigureList, type Option, SelectField, TextField } from "./fields";
import { ScrollRegion } from "./scroll-region";

const decimalInput = /^\d+([.,]\d{1,2})?$/;

function toMoney(value: string): string {
  return Number(value.replace(",", ".")).toFixed(2);
}

export function AssetsTable() {
  const t = useTranslations("finance.assets");
  const tStatus = useTranslations("finance.status");
  const assets = useQuery({
    queryKey: ["finance", "assets"],
    queryFn: () => rpc.finance.assets.list({ limit: 50 }),
  });

  if (assets.isError) return <ErrorBox error={errorPayload(assets.error)} />;

  const items = assets.data?.items ?? [];
  const withDefault = items.filter((asset) => asset.durationSource === "default").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">{t("landNote")}</p>
        <Link href="/finance/actifs/nouvelle" className={buttonVariants()}>
          {t("new")}
        </Link>
      </div>

      {assets.isPending ? <Skeleton className="h-40 w-full" /> : null}

      {assets.data && items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}

      {items.length > 0 ? (
        <>
          {withDefault > 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm" data-testid="assets-default">
              {t("defaultWarning", { count: withDefault })}
            </p>
          ) : null}
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.label")}</TableHead>
                  <TableHead scope="col">{t("columns.gross")}</TableHead>
                  <TableHead scope="col">{t("columns.land")}</TableHead>
                  <TableHead scope="col">{t("columns.depreciable")}</TableHead>
                  <TableHead scope="col">{t("columns.accumulated")}</TableHead>
                  <TableHead scope="col">{t("columns.nbv")}</TableHead>
                  <TableHead scope="col">{t("columns.duration")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell>
                      <Link
                        className="underline underline-offset-2"
                        href={`/finance/actifs/${asset.id}`}
                      >
                        {asset.label}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Money amount={asset.grossValue} currency={asset.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={asset.landValue} currency={asset.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={asset.depreciableGross} currency={asset.currency} />
                    </TableCell>
                    <TableCell>
                      <Money amount={asset.accumulatedAt} currency={asset.currency} />
                    </TableCell>
                    <TableCell data-testid="asset-nbv">
                      <Money amount={asset.netBookValueAt} currency={asset.currency} />
                    </TableCell>
                    <TableCell className="num">
                      {asset.durationMonths === 0
                        ? "—"
                        : `${Math.round(asset.durationMonths / 12)} ${t("years")}`}
                      {asset.durationSource === "default" ? (
                        <Badge variant="outline" className="ml-2">
                          {t("durationDefault")}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tStatus(asset.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
          <p className="text-xs text-muted-foreground">
            {t("computedOn")} <DateValue value={items[0]?.computedOn ?? null} />
          </p>
        </>
      ) : null}
    </div>
  );
}

export function AssetForm() {
  const t = useTranslations("finance.assets.form");
  const router = useRouter();
  const [legalEntityId, setLegalEntityId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [label, setLabel] = useState("");
  const [grossValue, setGrossValue] = useState("");
  const [landValue, setLandValue] = useState("");
  const [commissionedOn, setCommissionedOn] = useState("");
  const [durationYears, setDurationYears] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const entities: Option[] = (lookups.data?.legalEntities ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));
  const buildings: Option[] = (lookups.data?.buildings ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const create = useMutation({
    mutationFn: () =>
      rpc.finance.assets.create({
        legalEntityId,
        label,
        grossValue: toMoney(grossValue),
        landValue: toMoney(landValue),
        ...(buildingId ? { buildingId } : {}),
        ...(commissionedOn ? { commissionedOn } : {}),
        ...(durationYears ? { durationYears: Number(durationYears).toFixed(6) } : {}),
      }),
    onSuccess: (asset) => router.push(`/finance/actifs/${asset.id}`),
    onError: (cause) => setError(errorPayload(cause)),
  });

  const complete =
    legalEntityId !== "" &&
    label !== "" &&
    decimalInput.test(grossValue) &&
    decimalInput.test(landValue);

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
          <SelectField
            label={t("legalEntity")}
            value={legalEntityId}
            onChange={setLegalEntityId}
            options={entities}
            placeholder="—"
          />
          <SelectField
            label={t("building")}
            value={buildingId}
            onChange={setBuildingId}
            options={buildings}
            placeholder="—"
          />
          <TextField label={t("label")} value={label} onChange={setLabel} />
          <TextField
            label={t("grossValue")}
            value={grossValue}
            inputMode="decimal"
            onChange={setGrossValue}
          />
          <TextField
            label={t("landValue")}
            value={landValue}
            inputMode="decimal"
            onChange={setLandValue}
            hint={t("landHint")}
          />
          <TextField
            label={t("commissionedOn")}
            type="date"
            value={commissionedOn}
            onChange={setCommissionedOn}
          />
          <TextField
            label={t("durationYears")}
            value={durationYears}
            inputMode="numeric"
            onChange={setDurationYears}
            hint={t("durationHint")}
          />
        </CardContent>
      </Card>
      <Button type="submit" size="lg" disabled={!complete || create.isPending}>
        {create.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

function ComponentRow({
  component,
  currency,
  onSaved,
}: {
  component: AssetComponentPosition;
  currency: string;
  onSaved: (detail: FixedAssetDetail) => void;
}) {
  const t = useTranslations("finance.assets.components");
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(component.label);
  const [grossValue, setGrossValue] = useState(component.grossValue);
  const [durationYears, setDurationYears] = useState(
    component.durationYears === null ? "" : String(Number(component.durationYears)),
  );
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: () =>
      rpc.finance.assets.updateComponent({
        id: component.id,
        expectedVersion: component.version,
        label,
        grossValue: toMoney(grossValue),
        durationYears: durationYears === "" ? null : Number(durationYears).toFixed(6),
      }),
    onSuccess: (detail) => {
      setEditing(false);
      onSaved(detail);
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const remove = useMutation({
    mutationFn: () => rpc.finance.assets.removeComponent({ id: component.id }),
    onSuccess: onSaved,
    onError: (cause) => setError(errorPayload(cause)),
  });

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={6}>
          {error ? <ErrorBox error={error} /> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField label={t("label")} value={label} onChange={setLabel} />
            <TextField
              label={t("gross")}
              value={grossValue}
              inputMode="decimal"
              onChange={setGrossValue}
            />
            <TextField
              label={t("duration")}
              value={durationYears}
              inputMode="numeric"
              onChange={setDurationYears}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              {t("save")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>{component.label}</TableCell>
      <TableCell>
        <Money amount={component.grossValue} currency={currency} />
      </TableCell>
      <TableCell className="num">
        {component.durationMonths === 0 ? "—" : Math.round(component.durationMonths / 12)}
        {component.durationSource === "default" ? (
          <Badge variant="outline" className="ml-2">
            {t("default")}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell>
        <Money amount={component.accumulated} currency={currency} />
      </TableCell>
      <TableCell>
        <Money amount={component.netBookValue} currency={currency} />
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            {t("edit")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            {t("remove")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function AddComponentForm({
  assetId,
  onSaved,
}: {
  assetId: string;
  onSaved: (detail: FixedAssetDetail) => void;
}) {
  const t = useTranslations("finance.assets.components");
  const [label, setLabel] = useState("");
  const [grossValue, setGrossValue] = useState("");
  const [durationYears, setDurationYears] = useState("");
  const [commissionedOn, setCommissionedOn] = useState("");
  const [depreciable, setDepreciable] = useState("true");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const add = useMutation({
    mutationFn: () =>
      rpc.finance.assets.addComponent({
        fixedAssetId: assetId,
        label,
        grossValue: toMoney(grossValue),
        isDepreciable: depreciable === "true",
        ...(durationYears ? { durationYears: Number(durationYears).toFixed(6) } : {}),
        ...(commissionedOn ? { commissionedOn } : {}),
      }),
    onSuccess: (detail) => {
      setLabel("");
      setGrossValue("");
      setDurationYears("");
      onSaved(detail);
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        add.mutate();
      }}
    >
      {error ? <ErrorBox error={error} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TextField label={t("label")} value={label} onChange={setLabel} />
        <TextField
          label={t("gross")}
          value={grossValue}
          inputMode="decimal"
          onChange={setGrossValue}
        />
        <TextField
          label={t("duration")}
          value={durationYears}
          inputMode="numeric"
          onChange={setDurationYears}
        />
        <TextField
          label={t("commissionedOn")}
          type="date"
          value={commissionedOn}
          onChange={setCommissionedOn}
        />
        <SelectField
          label={t("nature")}
          value={depreciable}
          onChange={setDepreciable}
          options={[
            { value: "true", label: t("depreciable") },
            { value: "false", label: t("notDepreciable") },
          ]}
        />
      </div>
      <Button
        type="submit"
        disabled={label === "" || !decimalInput.test(grossValue) || add.isPending}
      >
        {t("add")}
      </Button>
    </form>
  );
}

function AssetEditor({
  asset,
  onSaved,
}: {
  asset: FixedAssetDetail;
  onSaved: (detail: FixedAssetDetail) => void;
}) {
  const t = useTranslations("finance.assets.form");
  const tDetail = useTranslations("finance.assets.detail");
  const [label, setLabel] = useState(asset.label);
  const [grossValue, setGrossValue] = useState(asset.grossValue);
  const [landValue, setLandValue] = useState(asset.landValue);
  const [commissionedOn, setCommissionedOn] = useState(asset.commissionedOn ?? "");
  const [durationYears, setDurationYears] = useState(
    asset.durationYears === null ? "" : String(Number(asset.durationYears)),
  );
  const [disposedOn, setDisposedOn] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: () =>
      rpc.finance.assets.update({
        id: asset.id,
        expectedVersion: asset.version,
        label,
        grossValue: toMoney(grossValue),
        landValue: toMoney(landValue),
        commissionedOn: commissionedOn === "" ? null : commissionedOn,
        durationYears: durationYears === "" ? null : Number(durationYears).toFixed(6),
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(errorPayload(cause)),
  });

  const dispose = useMutation({
    mutationFn: () =>
      rpc.finance.assets.dispose({
        id: asset.id,
        expectedVersion: asset.version,
        disposedOn,
        reason,
      }),
    onSuccess: onSaved,
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tDetail("edit")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorBox error={error} /> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label={t("label")} value={label} onChange={setLabel} />
          <TextField
            label={t("grossValue")}
            value={grossValue}
            inputMode="decimal"
            onChange={setGrossValue}
          />
          <TextField
            label={t("landValue")}
            value={landValue}
            inputMode="decimal"
            onChange={setLandValue}
          />
          <TextField
            label={t("commissionedOn")}
            type="date"
            value={commissionedOn}
            onChange={setCommissionedOn}
          />
          <TextField
            label={t("durationYears")}
            value={durationYears}
            inputMode="numeric"
            onChange={setDurationYears}
          />
        </div>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
          {tDetail("save")}
        </Button>

        <div className="border-t pt-4">
          <p className="text-sm text-muted-foreground">{tDetail("disposeHint")}</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label={tDetail("disposedOn")}
              type="date"
              value={disposedOn}
              onChange={setDisposedOn}
            />
            <TextField label={tDetail("reason")} value={reason} onChange={setReason} />
          </div>
          <Button
            type="button"
            variant="destructive"
            className="mt-3"
            onClick={() => dispose.mutate()}
            disabled={disposedOn === "" || reason.trim() === "" || dispose.isPending}
          >
            {tDetail("dispose")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AssetDetail({ id }: { id: string }) {
  const t = useTranslations("finance.assets");
  const tDetail = useTranslations("finance.assets.detail");
  const tStatus = useTranslations("finance.status");
  const queryClient = useQueryClient();
  const asset = useQuery({
    queryKey: ["finance", "asset", id],
    queryFn: () => rpc.finance.assets.get({ id }),
  });

  const onSaved = (detail: FixedAssetDetail) => {
    queryClient.setQueryData(["finance", "asset", id], detail);
    void queryClient.invalidateQueries({ queryKey: ["finance", "assets"] });
  };

  if (asset.isError) return <ErrorBox error={errorPayload(asset.error)} />;
  if (!asset.data) return <Skeleton className="h-64 w-full" />;
  const data = asset.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{data.label}</CardTitle>
          <CardDescription>
            <Badge variant="secondary">{tStatus(data.status)}</Badge>
            {data.buildingLabel ? ` · ${data.buildingLabel}` : null}
            {data.unitLabel ? ` · ${data.unitLabel}` : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FigureList>
            <Figure label={t("columns.gross")}>
              <Money amount={data.register.gross} currency={data.currency} />
            </Figure>
            <Figure label={t("columns.land")} hint={t("landNote")}>
              <Money amount={data.register.land} currency={data.currency} />
            </Figure>
            <Figure label={t("columns.accumulated")}>
              <Money amount={data.register.accumulated} currency={data.currency} />
            </Figure>
            <Figure label={t("columns.nbv")} testId="asset-detail-nbv">
              <Money amount={data.register.netBookValue} currency={data.currency} />
            </Figure>
          </FigureList>
          <p className="text-xs text-muted-foreground">
            {t("computedOn")} <DateValue value={data.register.asOf} />
            {data.register.usesDefaultDuration ? ` · ${tDetail("defaultApplied")}` : null}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tDetail("components")}</CardTitle>
          <CardDescription>{tDetail("componentsHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.components.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tDetail("noComponents")}</p>
          ) : (
            <ScrollRegion label={tDetail("components")}>
              <Table>
                <caption className="sr-only">{tDetail("components")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("columns.label")}</TableHead>
                    <TableHead scope="col">{t("columns.gross")}</TableHead>
                    <TableHead scope="col">{t("columns.duration")}</TableHead>
                    <TableHead scope="col">{t("columns.accumulated")}</TableHead>
                    <TableHead scope="col">{t("columns.nbv")}</TableHead>
                    <TableHead scope="col">{tDetail("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.components.map((component) => (
                    <ComponentRow
                      key={component.id}
                      component={component}
                      currency={data.currency}
                      onSaved={onSaved}
                    />
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}
          <AddComponentForm assetId={id} onSaved={onSaved} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tDetail("years")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.years.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tDetail("noYears")}</p>
          ) : (
            <ScrollRegion label={tDetail("years")}>
              <Table>
                <caption className="sr-only">{tDetail("years")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{tDetail("year")}</TableHead>
                    <TableHead scope="col">{tDetail("charge")}</TableHead>
                    <TableHead scope="col">{tDetail("cumulative")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.years.map((year) => (
                    <TableRow key={year.year}>
                      <TableCell className="num">{year.year}</TableCell>
                      <TableCell>
                        <Money amount={year.amount} currency={data.currency} />
                      </TableCell>
                      <TableCell>
                        <Money amount={year.cumulative} currency={data.currency} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          )}
        </CardContent>
      </Card>

      <AssetEditor asset={data} onSaved={onSaved} />
    </div>
  );
}
