"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorBox } from "@/components/feedback/error-box";
import { type Option, SelectField, TextAreaField, TextField } from "@/components/finance/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { AllocationKeyRead, AllocationKeyVersionRead } from "@/lib/contracts/charges";
import { errorPayload, rpc } from "@/lib/rpc";
import { ChargesTabs } from "./charges-tabs";
import { ConfirmButton } from "./confirm-button";

const BASES = [
  "tantiemes",
  "surface",
  "consumption",
  "occupants",
  "equal",
  "contractual",
  "other",
] as const;

const ROUNDINGS = ["largest_remainder", "first_id", "last_id", "proportional_truncate"] as const;

type ShareDraft = { unitId: string; share: string };

function total(shares: readonly ShareDraft[]): string {
  const sum = shares.reduce((acc, entry) => acc + Number(entry.share.replace(",", ".") || 0), 0);
  return sum.toFixed(6);
}

function ShareRows({
  shares,
  units,
  onChange,
  disabled,
  idPrefix,
}: {
  shares: ShareDraft[];
  units: Option[];
  onChange: (next: ShareDraft[]) => void;
  disabled: boolean;
  idPrefix: string;
}) {
  const t = useTranslations("charges.keys");
  return (
    <div className="space-y-3">
      {shares.map((entry, index) => (
        <fieldset
          // biome-ignore lint/suspicious/noArrayIndexKey: the row identity is its position in the draft.
          key={`${idPrefix}-${index}`}
          className="grid grid-cols-[auto_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
        >
          <legend className="sr-only">{`${t("unit")} ${index + 1}`}</legend>
          <SelectField
            label={t("unit")}
            value={entry.unitId}
            disabled={disabled}
            options={units}
            onChange={(value) =>
              onChange(shares.map((row, i) => (i === index ? { ...row, unitId: value } : row)))
            }
          />
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-share-${index}`}>{t("share")}</Label>
            <Input
              id={`${idPrefix}-share-${index}`}
              className="num"
              inputMode="decimal"
              disabled={disabled}
              value={entry.share}
              onChange={(event) =>
                onChange(
                  shares.map((row, i) =>
                    i === index ? { ...row, share: event.target.value } : row,
                  ),
                )
              }
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled || shares.length === 1}
            aria-label={t("removeShare")}
            onClick={() => onChange(shares.filter((_, i) => i !== index))}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...shares, { unitId: "", share: "" }])}
      >
        <Plus aria-hidden="true" />
        {t("addShare")}
      </Button>
      <p className="text-sm" data-testid={`${idPrefix}-total`}>
        {t("total")} : <span className="num">{total(shares)}</span>{" "}
        {total(shares) === "1.000000" ? (
          <span className="text-muted-foreground">{t("totalExact")}</span>
        ) : (
          <span className="text-destructive">{t("totalInexact", { total: total(shares) })}</span>
        )}
      </p>
    </div>
  );
}

function VersionCard({
  keyRow,
  version,
}: {
  keyRow: AllocationKeyRead;
  version: AllocationKeyVersionRead;
}) {
  const t = useTranslations("charges.keys");
  const client = useQueryClient();
  const [shares, setShares] = useState<ShareDraft[]>(
    version.shares.map((share) => ({ unitId: share.unitId ?? "", share: share.share })),
  );
  const units = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });
  const options: Option[] = (units.data?.units ?? []).map((unit) => ({
    value: unit.id,
    label: unit.label,
  }));

  const invalidate = () => client.invalidateQueries({ queryKey: ["charges"] });

  const save = useMutation({
    mutationFn: () =>
      rpc.charges.keys.updateVersion({
        keyVersionId: version.id,
        expectedVersion: version.version,
        shares: shares
          .filter((entry) => entry.unitId !== "")
          .map((entry) => ({ unitId: entry.unitId, share: entry.share.replace(",", ".") })),
      }),
    onSuccess: async () => {
      toast.success(t("saved"));
      await invalidate();
    },
  });
  const activate = useMutation({
    mutationFn: () =>
      rpc.charges.keys.activate({ keyVersionId: version.id, expectedVersion: version.version }),
    onSuccess: async () => {
      toast.success(t("activated"));
      await invalidate();
    },
  });

  return (
    <div
      className="space-y-3 rounded-lg border p-3"
      data-testid={`key-version-${version.sequence}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium">
          {t("version", { sequence: String(version.sequence) })}
        </h4>
        <Badge variant={version.status === "active" ? "default" : "outline"}>
          {t(`status.${version.status}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          <DateValue value={version.effectiveFrom} />
        </span>
        {version.usedByRunIds.length > 0 ? (
          <Badge variant="outline" className="gap-1">
            <Lock aria-hidden="true" />
            {t("frozenBy", { count: String(version.usedByRunIds.length) })}
          </Badge>
        ) : null}
      </div>

      {version.justification ? (
        <p className="text-sm text-muted-foreground">{version.justification}</p>
      ) : null}

      {!version.editable ? (
        <p className="text-sm text-muted-foreground">
          {version.usedByRunIds.length > 0 ? t("frozen") : t("notEditable")}
        </p>
      ) : null}

      <ShareRows
        shares={shares}
        units={options}
        disabled={!version.editable}
        idPrefix={`key-${keyRow.code}-v${version.sequence}`}
        onChange={setShares}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!version.editable || save.isPending}
          onClick={() => save.mutate()}
          data-testid={`key-version-save-${version.sequence}`}
        >
          {t("save")}
        </Button>
        <Button
          size="sm"
          disabled={version.status !== "draft" || activate.isPending}
          onClick={() => activate.mutate()}
          data-testid={`key-version-activate-${version.sequence}`}
        >
          <Check aria-hidden="true" />
          {t("activate")}
        </Button>
      </div>
      {save.error ? <ErrorBox error={errorPayload(save.error)} /> : null}
      {activate.error ? <ErrorBox error={errorPayload(activate.error)} /> : null}
    </div>
  );
}

function KeyCard({ keyRow }: { keyRow: AllocationKeyRead }) {
  const t = useTranslations("charges.keys");
  const client = useQueryClient();
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const fieldId = useId();

  const addVersion = useMutation({
    mutationFn: () =>
      rpc.charges.keys.addVersion({
        keyId: keyRow.id,
        effectiveFrom,
        shares: (keyRow.versions.at(-1)?.shares ?? [])
          .filter((share) => share.unitId !== null)
          .map((share) => ({ unitId: share.unitId as string, share: share.share })),
      }),
    onSuccess: async () => {
      toast.success(t("versionAdded"));
      setEffectiveFrom("");
      await client.invalidateQueries({ queryKey: ["charges"] });
    },
  });
  const retire = useMutation({
    mutationFn: () => rpc.charges.keys.retire({ id: keyRow.id, expectedVersion: keyRow.version }),
    onSuccess: async () => {
      toast.success(t("retired"));
      await client.invalidateQueries({ queryKey: ["charges"] });
    },
  });

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4" data-testid={`key-${keyRow.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold tracking-tight">
          {keyRow.code} — {keyRow.label}
        </h3>
        <Badge variant="outline">{t(`basisValue.${keyRow.basis}`)}</Badge>
        <Badge variant={keyRow.status === "active" ? "default" : "outline"}>
          {t(`keyStatus.${keyRow.status}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {keyRow.buildingName ?? keyRow.legalEntityName ?? "—"}
        </span>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">{t("versions")}</h4>
        {keyRow.versions.map((version) => (
          <VersionCard key={version.id} keyRow={keyRow} version={version} />
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-from`}>{t("effectiveFrom")}</Label>
          <Input
            id={`${fieldId}-from`}
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={!effectiveFrom || addVersion.isPending}
          onClick={() => addVersion.mutate()}
          data-testid={`key-add-version-${keyRow.code}`}
        >
          <Plus aria-hidden="true" />
          {t("newVersion")}
        </Button>
        <ConfirmButton
          label={t("retire")}
          title={t("retireConfirmTitle")}
          body={t("retireConfirmBody")}
          cancelLabel={t("cancel")}
          confirmLabel={t("confirm")}
          disabled={keyRow.status === "retired" || retire.isPending}
          testId={`key-retire-${keyRow.code}`}
          onConfirm={() => retire.mutate()}
        />
      </div>
      {addVersion.error ? <ErrorBox error={errorPayload(addVersion.error)} /> : null}
      {retire.error ? <ErrorBox error={errorPayload(retire.error)} /> : null}
    </section>
  );
}

export function KeysView() {
  const t = useTranslations("charges.keys");
  const client = useQueryClient();

  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [basis, setBasis] = useState<string>("tantiemes");
  const [roundingRule, setRoundingRule] = useState<string>("largest_remainder");
  const [buildingId, setBuildingId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [justification, setJustification] = useState("");
  const [shares, setShares] = useState<ShareDraft[]>([{ unitId: "", share: "" }]);

  const keys = useQuery({
    queryKey: ["charges", "keys"],
    queryFn: () => rpc.charges.keys.list({}),
  });
  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });

  const unitOptions: Option[] = (lookups.data?.units ?? [])
    .filter((unit) => buildingId === "" || unit.buildingId === buildingId)
    .map((unit) => ({ value: unit.id, label: unit.label }));

  const create = useMutation({
    mutationFn: () =>
      rpc.charges.keys.create({
        code,
        label,
        basis: basis as "tantiemes",
        buildingId,
        effectiveFrom,
        roundingRule: roundingRule as "largest_remainder",
        ...(justification.trim() ? { justification: justification.trim() } : {}),
        shares: shares
          .filter((entry) => entry.unitId !== "")
          .map((entry) => ({ unitId: entry.unitId, share: entry.share.replace(",", ".") })),
      }),
    onSuccess: async () => {
      toast.success(t("created"));
      setCode("");
      setLabel("");
      setJustification("");
      setShares([{ unitId: "", share: "" }]);
      await client.invalidateQueries({ queryKey: ["charges"] });
    },
  });

  return (
    <div className="space-y-6">
      <ChargesTabs />

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold tracking-tight">{t("new")}</h2>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label={t("code")} value={code} onChange={setCode} required />
            <TextField label={t("label")} value={label} onChange={setLabel} required />
            <SelectField
              label={t("basis")}
              value={basis}
              onChange={setBasis}
              options={BASES.map((value) => ({ value, label: t(`basisValue.${value}`) }))}
            />
            <SelectField
              label={t("scopeBuilding")}
              value={buildingId}
              onChange={setBuildingId}
              options={(lookups.data?.buildings ?? []).map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
            />
            <TextField
              label={t("effectiveFrom")}
              type="date"
              value={effectiveFrom}
              onChange={setEffectiveFrom}
              required
            />
            <SelectField
              label={t("roundingRule")}
              value={roundingRule}
              onChange={setRoundingRule}
              options={ROUNDINGS.map((value) => ({ value, label: t(`rounding.${value}`) }))}
            />
          </div>

          <TextAreaField
            label={t("justification")}
            value={justification}
            onChange={setJustification}
          />

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t("shares")}</legend>
            <p className="text-xs text-muted-foreground">{t("shareHint")}</p>
            <ShareRows
              shares={shares}
              units={unitOptions}
              disabled={false}
              idPrefix="key-new"
              onChange={setShares}
            />
          </fieldset>

          <Button
            type="submit"
            disabled={create.isPending || !code || !label || !buildingId || !effectiveFrom}
            data-testid="key-create"
          >
            {t("create")}
          </Button>
        </form>
        {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}
      </section>

      {keys.isError ? <ErrorBox error={errorPayload(keys.error)} /> : null}
      {keys.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {keys.data && keys.data.items.length === 0 ? (
        <EmptyState title={t("title")}>{t("empty")}</EmptyState>
      ) : null}
      {(keys.data?.items ?? []).map((keyRow) => (
        <KeyCard key={keyRow.id} keyRow={keyRow} />
      ))}
    </div>
  );
}
