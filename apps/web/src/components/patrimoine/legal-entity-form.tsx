"use client";

import { api, type ErrorPayload, type LegalEntity } from "@lfsci/contracts";
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
  name: string;
  legalForm: string;
  siren: string;
  incomeTaxRegime: string;
  vatStatus: string;
  eInvoicingChannel: string;
  fiscalYearEndMonth: string;
  fiscalYearEndDay: string;
  status: string;
};

type Props = { entity?: LegalEntity };

export function LegalEntityForm({ entity }: Props) {
  const t = useTranslations("patrimoine");
  const router = useRouter();
  const [error, setError] = useState<ErrorPayload | null>(null);

  const save = useMutation({
    mutationFn: async (values: Values) => {
      if (entity) {
        return rpc.patrimoine.legalEntities.update(
          api.patrimoine.updateLegalEntity.input.parse(toUpdate(entity, values)),
        );
      }
      return rpc.patrimoine.legalEntities.create(
        api.patrimoine.createLegalEntity.input.parse(toCreate(values)),
      );
    },
    onSuccess: (saved) => {
      toast.success(t("entity.created"));
      router.push(`/patrimoine/sci/${saved.id}`);
      router.refresh();
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const defaults: Values = {
    name: entity?.name ?? "",
    legalForm: entity?.legalForm ?? "sci",
    siren: entity?.siren ?? "",
    incomeTaxRegime: entity?.incomeTaxRegime ?? "to_qualify",
    vatStatus: entity?.vatStatus ?? "to_qualify",
    eInvoicingChannel: entity?.eInvoicingChannel ?? "to_qualify",
    fiscalYearEndMonth: entity?.fiscalYearEndMonth?.toString() ?? "12",
    fiscalYearEndDay: entity?.fiscalYearEndDay?.toString() ?? "31",
    status: entity?.status ?? "active",
  };

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onSubmit: entity
        ? validateWith<Values>(api.patrimoine.updateLegalEntity.input, (values) =>
            toUpdate(entity, values),
          )
        : validateWith<Values>(api.patrimoine.createLegalEntity.input, toCreate),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      await save.mutateAsync(value);
    },
  });

  const legalForms = t.raw("legalForm") as Record<string, string>;

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
        <form.Field name="name">
          {(field) => (
            <TextField
              label={t("entity.name")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required
            />
          )}
        </form.Field>
        <form.Field name="legalForm">
          {(field) => (
            <SelectField
              label={t("entity.legalForm")}
              value={field.state.value}
              options={legalForms}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="siren">
          {(field) => (
            <TextField
              label={t("entity.siren")}
              hint={t("entity.sirenHint")}
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="incomeTaxRegime">
          {(field) => (
            <SelectField
              label={t("entity.incomeTaxRegime")}
              value={field.state.value}
              options={t.raw("incomeTaxRegime") as Record<string, string>}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="vatStatus">
          {(field) => (
            <SelectField
              label={t("entity.vatStatus")}
              value={field.state.value}
              options={t.raw("vatStatus") as Record<string, string>}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="fiscalYearEndMonth">
          {(field) => (
            <TextField
              label={t("entity.fiscalYearEndMonth")}
              type="number"
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field name="fiscalYearEndDay">
          {(field) => (
            <TextField
              label={t("entity.fiscalYearEndDay")}
              type="number"
              value={field.state.value}
              errors={field.state.meta.errors}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        {entity ? (
          <>
            <form.Field name="eInvoicingChannel">
              {(field) => (
                <SelectField
                  label={t("entity.eInvoicingChannel")}
                  value={field.state.value}
                  options={t.raw("eInvoicingChannel") as Record<string, string>}
                  errors={field.state.meta.errors}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>
            <form.Field name="status">
              {(field) => (
                <SelectField
                  label={t("entity.status")}
                  value={field.state.value}
                  options={t.raw("entityStatus") as Record<string, string>}
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
    name: values.name.trim(),
    legalForm: values.legalForm,
    ...(trimmed(values.siren) === undefined ? {} : { siren: trimmed(values.siren) }),
    incomeTaxRegime: values.incomeTaxRegime,
    vatStatus: values.vatStatus,
    ...(numeric(values.fiscalYearEndMonth) === undefined
      ? {}
      : { fiscalYearEndMonth: numeric(values.fiscalYearEndMonth) }),
    ...(numeric(values.fiscalYearEndDay) === undefined
      ? {}
      : { fiscalYearEndDay: numeric(values.fiscalYearEndDay) }),
  };
}

function toUpdate(entity: LegalEntity, values: Values) {
  return {
    id: entity.id,
    expectedVersion: entity.version,
    name: values.name.trim(),
    siren: trimmed(values.siren) ?? null,
    incomeTaxRegime: values.incomeTaxRegime,
    vatStatus: values.vatStatus,
    eInvoicingChannel: values.eInvoicingChannel,
    status: values.status,
  };
}
