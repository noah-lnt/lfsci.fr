"use client";

import { api, type Building, type ErrorPayload, type LegalEntity } from "@lfsci/contracts";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { errorPayload, rpc } from "@/lib/rpc";
import { FormGrid, SelectField, TextField, trimmed, validateWith } from "./form-kit";

type Values = {
  legalEntityId: string;
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  cadastralRef: string;
  acquiredOn: string;
  soldOn: string;
  status: string;
};

type Props = {
  entities: LegalEntity[];
  building?: Building;
  defaultLegalEntityId?: string;
};

export function BuildingForm({ entities, building, defaultLegalEntityId }: Props) {
  const t = useTranslations("patrimoine");
  const router = useRouter();
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: async (values: Values) =>
      building
        ? rpc.patrimoine.buildings.update(
            api.patrimoine.updateBuilding.input.parse(toUpdate(building, values)),
          )
        : rpc.patrimoine.buildings.create(
            api.patrimoine.createBuilding.input.parse(toCreate(values)),
          ),
    onSuccess: (saved) => {
      toast.success(t("building.created"));
      router.push(`/patrimoine/immeubles/${saved.id}`);
      router.refresh();
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const defaults: Values = {
    legalEntityId: building?.legalEntityId ?? defaultLegalEntityId ?? entities[0]?.id ?? "",
    code: building?.code ?? "",
    name: building?.name ?? "",
    addressLine1: building?.addressLine1 ?? "",
    addressLine2: building?.addressLine2 ?? "",
    postalCode: building?.postalCode ?? "",
    city: building?.city ?? "",
    cadastralRef: building?.cadastralRef ?? "",
    acquiredOn: building?.acquiredOn ?? "",
    soldOn: building?.soldOn ?? "",
    status: building?.status ?? "active",
  };

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onSubmit: building
        ? validateWith<Values>(api.patrimoine.updateBuilding.input, (values) =>
            toUpdate(building, values),
          )
        : validateWith<Values>(api.patrimoine.createBuilding.input, toCreate),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      await save.mutateAsync(value);
    },
  });

  const entityOptions = Object.fromEntries(entities.map((entity) => [entity.id, entity.name]));

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
        {building ? null : (
          <form.Field name="legalEntityId">
            {(field) => (
              <SelectField
                label={t("building.legalEntity")}
                value={field.state.value}
                options={entityOptions}
                errors={field.state.meta.errors}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        )}
        <form.Field name="code">
          {(field) => (
            <TextField
              label={t("building.code")}
              hint={t("building.codeHint")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required
            />
          )}
        </form.Field>
        <form.Field name="name">
          {(field) => (
            <TextField
              label={t("building.name")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required
            />
          )}
        </form.Field>
        <form.Field name="addressLine1">
          {(field) => (
            <TextField
              label={t("building.addressLine1")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required
            />
          )}
        </form.Field>
        <form.Field name="addressLine2">
          {(field) => (
            <TextField
              label={t("building.addressLine2")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="postalCode">
          {(field) => (
            <TextField
              label={t("building.postalCode")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="city">
          {(field) => (
            <TextField
              label={t("building.city")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        {building ? (
          <>
            <form.Field name="cadastralRef">
              {(field) => (
                <TextField
                  label={t("building.cadastralRef")}
                  value={field.state.value}
                  errors={field.state.meta.errors}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
            <form.Field name="soldOn">
              {(field) => (
                <TextField
                  label={t("building.soldOn")}
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
                  label={t("building.status")}
                  value={field.state.value}
                  options={t.raw("buildingStatus") as Record<string, string>}
                  errors={field.state.meta.errors}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
          </>
        ) : (
          <form.Field name="acquiredOn">
            {(field) => (
              <TextField
                label={t("building.acquiredOn")}
                type="date"
                value={field.state.value}
                errors={field.state.meta.errors}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
            )}
          </form.Field>
        )}
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
    legalEntityId: values.legalEntityId,
    code: values.code.trim(),
    name: values.name.trim(),
    addressLine1: values.addressLine1.trim(),
    ...(trimmed(values.addressLine2) === undefined
      ? {}
      : { addressLine2: trimmed(values.addressLine2) }),
    ...(trimmed(values.postalCode) === undefined ? {} : { postalCode: trimmed(values.postalCode) }),
    ...(trimmed(values.city) === undefined ? {} : { city: trimmed(values.city) }),
    ...(trimmed(values.acquiredOn) === undefined ? {} : { acquiredOn: trimmed(values.acquiredOn) }),
  };
}

function toUpdate(building: Building, values: Values) {
  return {
    id: building.id,
    expectedVersion: building.version,
    name: values.name.trim(),
    addressLine1: values.addressLine1.trim(),
    addressLine2: trimmed(values.addressLine2) ?? null,
    postalCode: trimmed(values.postalCode) ?? null,
    city: trimmed(values.city) ?? null,
    cadastralRef: trimmed(values.cadastralRef) ?? null,
    soldOn: trimmed(values.soldOn) ?? null,
    status: values.status,
  };
}
