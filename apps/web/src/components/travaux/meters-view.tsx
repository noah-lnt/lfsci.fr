"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { type Option, SelectField, TextField } from "@/components/finance/fields";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const FLUIDS = [
  "water_cold",
  "water_hot",
  "electricity",
  "gas",
  "heat",
  "pv_production",
  "other",
] as const;
const SCOPES = ["individual", "sub_meter", "collective"] as const;
const ORIGINS = ["owner", "tenant", "provider", "inspection", "estimate", "import"] as const;

function CreateMeterForm({ buildings }: { buildings: readonly Option[] }) {
  const t = useTranslations("travaux.meters.form");
  const tFluids = useTranslations("travaux.meters.fluids");
  const tScopes = useTranslations("travaux.meters.scopes");
  const queryClient = useQueryClient();

  const [buildingId, setBuildingId] = useState(buildings[0]?.value ?? "");
  const [fluid, setFluid] = useState<string>("water_cold");
  const [scope, setScope] = useState<string>("individual");
  const [unitOfMeasure, setUnitOfMeasure] = useState("m³");
  const [serialNumber, setSerialNumber] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);

  const create = useMutation({
    mutationFn: () =>
      rpc.travaux.meters.create({
        buildingId,
        fluid: fluid as "water_cold",
        scope: scope as "individual",
        unitOfMeasure,
        ...(serialNumber ? { serialNumber } : {}),
      }),
    onSuccess: async () => {
      setError(null);
      setSerialNumber("");
      await queryClient.invalidateQueries({ queryKey: ["travaux", "meters"] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          {error ? <ErrorBox error={error} /> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t("building")}
              value={buildingId}
              onChange={setBuildingId}
              options={buildings}
              placeholder="—"
            />
            <SelectField
              label={t("fluid")}
              value={fluid}
              onChange={setFluid}
              options={FLUIDS.map((value) => ({ value, label: tFluids(value) }))}
            />
            <SelectField
              label={t("scope")}
              value={scope}
              onChange={setScope}
              options={SCOPES.map((value) => ({ value, label: tScopes(value) }))}
            />
            <TextField
              label={t("unitOfMeasure")}
              value={unitOfMeasure}
              onChange={setUnitOfMeasure}
            />
            <TextField label={t("serialNumber")} value={serialNumber} onChange={setSerialNumber} />
          </div>
          <Button type="submit" disabled={buildingId === "" || create.isPending}>
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ReadingsPanel({ meters }: { meters: readonly Option[] }) {
  const t = useTranslations("travaux.meters.readings");
  const tOrigins = useTranslations("travaux.meters.origins");
  const tStatus = useTranslations("travaux.status");
  const queryClient = useQueryClient();
  const photoId = useId();
  const photoHintId = `${photoId}-hint`;

  const [meterId, setMeterId] = useState(meters[0]?.value ?? "");
  const [indexValue, setIndexValue] = useState("");
  const [readOn, setReadOn] = useState(new Date().toISOString().slice(0, 10));
  const [origin, setOrigin] = useState<string>("owner");
  const [photoDocumentId, setPhotoDocumentId] = useState("");
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [exception, setException] = useState<string | null>(null);

  const readings = useQuery({
    queryKey: ["travaux", "meters", meterId, "readings"],
    queryFn: () => rpc.travaux.meters.readings.list({ meterId, limit: 50 }),
    enabled: meterId !== "",
  });

  const record = useMutation({
    mutationFn: () =>
      rpc.travaux.meters.readings.record({
        meterId,
        indexValue: Number(indexValue.replace(",", ".")).toFixed(4),
        readOn,
        origin: origin as "owner",
        ...(photoDocumentId ? { photoDocumentId } : {}),
      }),
    onSuccess: async (reading) => {
      setError(null);
      setIndexValue("");
      setException(
        reading.status === "exception" ? (reading.exceptionReason ?? t("exception")) : null,
      );
      await queryClient.invalidateQueries({ queryKey: ["travaux", "meters"] });
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            record.mutate();
          }}
        >
          {error ? <ErrorBox error={error} /> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label={t("meter")}
              value={meterId}
              onChange={setMeterId}
              options={meters}
              placeholder="—"
            />
            <TextField
              label={t("indexValue")}
              value={indexValue}
              inputMode="decimal"
              onChange={setIndexValue}
            />
            <TextField label={t("readOn")} type="date" value={readOn} onChange={setReadOn} />
            <SelectField
              label={t("origin")}
              value={origin}
              onChange={setOrigin}
              options={ORIGINS.map((value) => ({ value, label: tOrigins(value) }))}
            />
            <div className="space-y-1.5">
              <Label htmlFor={photoId}>{t("photo")}</Label>
              <Input
                id={photoId}
                type="file"
                accept="image/*"
                capture="environment"
                aria-describedby={photoHintId}
                onChange={() => undefined}
              />
              <p id={photoHintId} className="text-xs text-muted-foreground">
                {t("photoHint")}
              </p>
            </div>
            <TextField
              label="Identifiant du document"
              value={photoDocumentId}
              onChange={setPhotoDocumentId}
            />
          </div>
          <Button type="submit" disabled={meterId === "" || indexValue === "" || record.isPending}>
            {record.isPending ? t("submitting") : t("submit")}
          </Button>
          {exception ? (
            <p role="alert" className="text-sm text-warning" data-testid="reading-exception">
              {exception}
            </p>
          ) : null}
        </form>

        {readings.isPending && meterId !== "" ? <Skeleton className="h-32 w-full" /> : null}
        {readings.data && readings.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : null}
        {readings.data && readings.data.items.length > 0 ? (
          <ScrollRegion label={t("title")}>
            <Table>
              <caption className="sr-only">{t("title")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("columns.readOn")}</TableHead>
                  <TableHead scope="col">{t("columns.indexValue")}</TableHead>
                  <TableHead scope="col">{t("columns.previous")}</TableHead>
                  <TableHead scope="col">{t("columns.consumption")}</TableHead>
                  <TableHead scope="col">{t("columns.origin")}</TableHead>
                  <TableHead scope="col">{t("columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readings.data.items.map((reading) => (
                  <TableRow key={reading.id}>
                    <TableCell>
                      <DateValue value={reading.readOn} />
                    </TableCell>
                    <TableCell className="num">{reading.indexValue}</TableCell>
                    <TableCell className="num">{reading.previousIndexValue ?? "—"}</TableCell>
                    <TableCell className="num">
                      {reading.consumption === null
                        ? "—"
                        : `${reading.consumption} ${reading.unitOfMeasure}`}
                    </TableCell>
                    <TableCell>{tOrigins(reading.origin)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{tStatus(reading.status)}</Badge>
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

export function MetersView() {
  const t = useTranslations("travaux.meters");
  const tFluids = useTranslations("travaux.meters.fluids");
  const tScopes = useTranslations("travaux.meters.scopes");

  const meters = useQuery({
    queryKey: ["travaux", "meters"],
    queryFn: () => rpc.travaux.meters.list({ limit: 50 }),
  });
  const lookups = useQuery({
    queryKey: ["travaux", "lookups"],
    queryFn: () => rpc.travaux.lookups({}),
  });

  if (meters.isError) return <ErrorBox error={errorPayload(meters.error)} />;

  const buildingOptions: Option[] = (lookups.data?.buildings ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));
  const meterOptions: Option[] = (meters.data?.items ?? []).map((meter) => ({
    value: meter.id,
    label: `${tFluids(meter.fluid)} · ${meter.serialNumber ?? meter.buildingLabel}`,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("readings.exception")}</CardDescription>
        </CardHeader>
        <CardContent>
          {meters.isPending ? <Skeleton className="h-32 w-full" /> : null}
          {meters.data && meters.data.items.length === 0 ? (
            <EmptyState title={t("title")}>{t("empty")}</EmptyState>
          ) : null}
          {meters.data && meters.data.items.length > 0 ? (
            <ScrollRegion label={t("title")}>
              <Table>
                <caption className="sr-only">{t("title")}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t("columns.fluid")}</TableHead>
                    <TableHead scope="col">{t("columns.scope")}</TableHead>
                    <TableHead scope="col">{t("columns.serial")}</TableHead>
                    <TableHead scope="col">{t("columns.building")}</TableHead>
                    <TableHead scope="col">{t("columns.lastIndex")}</TableHead>
                    <TableHead scope="col">{t("columns.lastReadOn")}</TableHead>
                    <TableHead scope="col">{t("columns.exceptions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meters.data.items.map((meter) => (
                    <TableRow key={meter.id}>
                      <TableCell>{tFluids(meter.fluid)}</TableCell>
                      <TableCell>{tScopes(meter.scope)}</TableCell>
                      <TableCell className="num">{meter.serialNumber ?? "—"}</TableCell>
                      <TableCell>{meter.buildingLabel}</TableCell>
                      <TableCell className="num">{meter.lastIndexValue ?? "—"}</TableCell>
                      <TableCell>
                        <DateValue value={meter.lastReadOn} />
                      </TableCell>
                      <TableCell className="num" data-testid="meter-exceptions">
                        {meter.openExceptions}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollRegion>
          ) : null}
        </CardContent>
      </Card>

      {meterOptions.length > 0 ? <ReadingsPanel meters={meterOptions} /> : null}
      {buildingOptions.length > 0 ? <CreateMeterForm buildings={buildingOptions} /> : null}
    </div>
  );
}
