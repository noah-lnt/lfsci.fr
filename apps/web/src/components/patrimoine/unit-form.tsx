"use client";

import { api, type Building, type ErrorPayload, type Unit } from "@lfsci/contracts";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { errorPayload, rpc } from "@/lib/rpc";
import { FormGrid, numeric, SelectField, TextField, trimmed, validateWith } from "./form-kit";

type Values = {
  buildingId: string;
  code: string;
  label: string;
  kind: string;
  floor: string;
  roomCount: string;
  livingAreaSqm: string;
  energyClass: string;
  energyAuditOn: string;
  status: string;
};

type Props = { buildings: Building[]; unit?: Unit; defaultBuildingId?: string };

const NONE = "none";

export function UnitForm({ buildings, unit, defaultBuildingId }: Props) {
  const t = useTranslations("patrimoine");
  const router = useRouter();
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: async (values: Values) =>
      unit
        ? rpc.patrimoine.units.update(api.patrimoine.updateUnit.input.parse(toUpdate(unit, values)))
        : rpc.patrimoine.units.create(api.patrimoine.createUnit.input.parse(toCreate(values))),
    onSuccess: (saved) => {
      toast.success(t("unit.created"));
      router.push(`/patrimoine/lots/${saved.id}`);
      router.refresh();
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const defaults: Values = {
    buildingId: unit?.buildingId ?? defaultBuildingId ?? buildings[0]?.id ?? "",
    code: unit?.code ?? "",
    label: unit?.label ?? "",
    kind: unit?.kind ?? "dwelling",
    floor: unit?.floor ?? "",
    roomCount: unit?.roomCount?.toString() ?? "",
    livingAreaSqm: unit?.livingAreaSqm ?? "",
    energyClass: unit?.energyClass ?? NONE,
    energyAuditOn: unit?.energyAuditOn ?? "",
    status: unit?.status ?? "active",
  };

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onSubmit: unit
        ? validateWith<Values>(api.patrimoine.updateUnit.input, (values) => toUpdate(unit, values))
        : validateWith<Values>(api.patrimoine.createUnit.input, toCreate),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      await save.mutateAsync(value);
    },
  });

  const buildingOptions = Object.fromEntries(
    buildings.map((building) => [building.id, `${building.code} — ${building.name}`]),
  );
  const energyOptions = {
    [NONE]: "—",
    A: "A",
    B: "B",
    C: "C",
    D: "D",
    E: "E",
    F: "F",
    G: "G",
  };

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FormGrid>
        {unit ? null : (
          <form.Field name="buildingId">
            {(field) => (
              <SelectField
                label={t("unit.building")}
                value={field.state.value}
                options={buildingOptions}
                errors={field.state.meta.errors}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        )}
        <form.Field name="code">
          {(field) => (
            <TextField
              label={t("unit.code")}
              hint={t("unit.codeHint")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required
            />
          )}
        </form.Field>
        <form.Field name="label">
          {(field) => (
            <TextField
              label={t("unit.label")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required
            />
          )}
        </form.Field>
        <form.Field name="kind">
          {(field) => (
            <SelectField
              label={t("unit.kind")}
              value={field.state.value}
              options={t.raw("unitKind") as Record<string, string>}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="floor">
          {(field) => (
            <TextField
              label={t("unit.floor")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="roomCount">
          {(field) => (
            <TextField
              label={t("unit.roomCount")}
              type="number"
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="livingAreaSqm">
          {(field) => (
            <TextField
              label={t("unit.livingAreaSqm")}
              value={field.state.value}
              placeholder="34.50"
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="energyClass">
          {(field) => (
            <SelectField
              label={t("unit.energyClass")}
              value={field.state.value}
              options={energyOptions}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        {unit ? (
          <>
            <form.Field name="energyAuditOn">
              {(field) => (
                <TextField
                  label={t("unit.energyAuditOn")}
                  type="date"
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
            <form.Field name="status">
              {(field) => (
                <SelectField
                  label={t("unit.status")}
                  value={field.state.value}
                  options={t.raw("unitStatus") as Record<string, string>}
                  errors={field.state.meta.errors}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
          </>
        ) : null}
      </FormGrid>

      {error ? <ErrorBox error={error} /> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" className="h-11 sm:h-9" disabled={save.isPending}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-11 sm:h-9"
          onClick={() => router.back()}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function toCreate(values: Values) {
  return {
    buildingId: values.buildingId,
    code: values.code.trim(),
    label: values.label.trim(),
    kind: values.kind,
    ...(trimmed(values.floor) === undefined ? {} : { floor: trimmed(values.floor) }),
    ...(numeric(values.roomCount) === undefined ? {} : { roomCount: numeric(values.roomCount) }),
    ...(trimmed(values.livingAreaSqm) === undefined
      ? {}
      : { livingAreaSqm: trimmed(values.livingAreaSqm) }),
    ...(values.energyClass === NONE ? {} : { energyClass: values.energyClass }),
  };
}

function toUpdate(unit: Unit, values: Values) {
  return {
    id: unit.id,
    expectedVersion: unit.version,
    label: values.label.trim(),
    kind: values.kind,
    floor: trimmed(values.floor) ?? null,
    roomCount: numeric(values.roomCount) ?? null,
    livingAreaSqm: trimmed(values.livingAreaSqm) ?? null,
    energyClass: values.energyClass === NONE ? null : values.energyClass,
    energyAuditOn: trimmed(values.energyAuditOn) ?? null,
    status: values.status,
  };
}
