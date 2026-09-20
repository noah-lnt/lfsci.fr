"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { allocateExpense, decimal, sum, toMoney, ZERO } from "@lfsci/domain";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { UNALLOCATED_TARGET } from "@/lib/contracts/finance";
import { errorPayload, rpc } from "@/lib/rpc";
import { type Option, SelectField, TextField } from "./fields";

type TargetKind = "unit" | "building_common" | "entity_common";

type TargetDraft = { target: TargetKind; refId: string; sharePercent: string };

type LineDraft = {
  description: string;
  amountInclTax: string;
  recoverablePercent: string;
  targets: TargetDraft[];
  residualPercent: string;
};

const emptyLine = (): LineDraft => ({
  description: "",
  amountInclTax: "",
  recoverablePercent: "0",
  targets: [{ target: "unit", refId: "", sharePercent: "100" }],
  residualPercent: "0",
});

function toShare(percent: string): string {
  const value = percent.trim() === "" ? ZERO : decimal(percent.replace(",", "."));
  return value.dividedBy(100).toFixed(6);
}

function isMoney(value: string): boolean {
  return /^\d{1,12}([.,]\d{1,2})?$/.test(value.trim());
}

function normaliseMoney(value: string): string {
  return toMoney(decimal(value.trim().replace(",", ".")));
}

/**
 * DEP-01/DEP-02 + CHA-01: one screen captures the expense, its lines and their
 * allocation. The preview calls the same domain split the server runs, so what
 * the owner reads before saving is what is written.
 */
export function ExpenseForm() {
  const t = useTranslations("finance.expenses.form");
  const tPayer = useTranslations("finance.payer");
  const tKind = useTranslations("finance.documentKind");
  const router = useRouter();

  const [legalEntityId, setLegalEntityId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [documentKind, setDocumentKind] = useState("invoice");
  const [issuedOn, setIssuedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [payer, setPayer] = useState("entity");
  const [paidByPersonId, setPaidByPersonId] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const lookups = useQuery({
    queryKey: ["finance", "lookups"],
    queryFn: () => rpc.finance.lookups({}),
  });

  const entityOptions: Option[] = (lookups.data?.legalEntities ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));
  const supplierOptions: Option[] = [
    { value: "", label: t("supplierNew") },
    ...(lookups.data?.suppliers ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
  ];
  const personOptions: Option[] = (lookups.data?.persons ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));
  const unitOptions: Option[] = (lookups.data?.units ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));
  const buildingOptions: Option[] = (lookups.data?.buildings ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
  }));

  const totalInclTax = toMoney(
    sum(
      lines.map((line) =>
        isMoney(line.amountInclTax) ? decimal(line.amountInclTax.replace(",", ".")) : ZERO,
      ),
    ),
  );

  function previewOf(line: LineDraft): { byTarget: Map<number, string>; residual: string } | null {
    if (!isMoney(line.amountInclTax)) return null;
    const shares = [
      ...line.targets.map((target, index) => ({
        lotId: String(index),
        share: toShare(target.sharePercent),
      })),
      ...(decimal(toShare(line.residualPercent)).isZero()
        ? []
        : [{ lotId: UNALLOCATED_TARGET, share: toShare(line.residualPercent) }]),
    ];
    const split = allocateExpense({
      amount: normaliseMoney(line.amountInclTax),
      key: { version: 1, shares },
    });
    if (!split.ok) return null;
    const byTarget = new Map<number, string>();
    let residual = "0.00";
    for (const lot of split.lots) {
      if (lot.lotId === UNALLOCATED_TARGET) residual = lot.amount;
      else byTarget.set(Number(lot.lotId), lot.amount);
    }
    return { byTarget, residual };
  }

  const updateLine = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );

  const updateTarget = (lineIndex: number, targetIndex: number, patch: Partial<TargetDraft>) =>
    setLines((current) =>
      current.map((line, position) =>
        position === lineIndex
          ? {
              ...line,
              targets: line.targets.map((target, tPosition) =>
                tPosition === targetIndex ? { ...target, ...patch } : target,
              ),
            }
          : line,
      ),
    );

  const save = useMutation({
    mutationFn: async () => {
      const expense = await rpc.finance.expenses.capture({
        legalEntityId,
        documentKind: documentKind as "invoice",
        totalInclTax,
        issuedOn,
        ...(reference ? { supplierReference: reference } : {}),
        ...(supplierId ? { supplierId } : {}),
        ...(!supplierId && supplierName ? { supplierName } : {}),
        payer: payer as "entity",
        ...(payer === "partner" && paidByPersonId ? { paidByPersonId } : {}),
        lines: lines.map((line) => ({
          description: line.description,
          amountInclTax: normaliseMoney(line.amountInclTax),
          recoverableShare: toShare(line.recoverablePercent),
        })),
      });

      return rpc.finance.expenses.allocate({
        id: expense.id,
        expectedVersion: expense.version,
        lines: lines.map((line, index) => ({
          lineNumber: index + 1,
          recoverableShare: toShare(line.recoverablePercent),
          ...(decimal(toShare(line.residualPercent)).isZero()
            ? {}
            : { unallocatedShare: toShare(line.residualPercent) }),
          targets: line.targets.map((target) => ({
            target: target.target,
            ...(target.target === "unit" ? { unitId: target.refId } : {}),
            ...(target.target === "building_common" ? { buildingId: target.refId } : {}),
            ...(target.target === "entity_common" ? { legalEntityId } : {}),
            share: toShare(target.sharePercent),
          })),
        })),
      });
    },
    onSuccess: (expense) => router.push(`/finance/depenses/${expense.id}`),
    onError: (cause) => setError(errorPayload(cause)),
  });

  const sharesValid = lines.every((line) => {
    const total = sum([
      ...line.targets.map((target) => decimal(toShare(target.sharePercent))),
      decimal(toShare(line.residualPercent)),
    ]);
    return total.equals(1);
  });
  const complete =
    legalEntityId !== "" &&
    (supplierId !== "" || supplierName !== "") &&
    lines.every(
      (line) =>
        line.description !== "" &&
        isMoney(line.amountInclTax) &&
        line.targets.every((target) => target.target === "entity_common" || target.refId !== ""),
    );

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        save.mutate();
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
            options={entityOptions}
            placeholder="—"
          />
          <SelectField
            label={t("supplierPick")}
            value={supplierId}
            onChange={setSupplierId}
            options={supplierOptions}
            placeholder={t("supplierNew")}
          />
          {supplierId === "" ? (
            <TextField label={t("supplierName")} value={supplierName} onChange={setSupplierName} />
          ) : null}
          <SelectField
            label={t("documentKind")}
            value={documentKind}
            onChange={setDocumentKind}
            options={["receipt", "invoice", "credit_note", "e_invoice", "statement"].map(
              (kind) => ({
                value: kind,
                label: tKind(kind as "invoice"),
              }),
            )}
          />
          <TextField label={t("issuedOn")} type="date" value={issuedOn} onChange={setIssuedOn} />
          <TextField label={t("reference")} value={reference} onChange={setReference} />
          <SelectField
            label={t("payer")}
            value={payer}
            onChange={setPayer}
            options={["entity", "partner", "tenant", "insurer", "unknown"].map((kind) => ({
              value: kind,
              label: tPayer(kind as "entity"),
            }))}
          />
          {payer === "partner" ? (
            <SelectField
              label={t("paidByPerson")}
              value={paidByPersonId}
              onChange={setPaidByPersonId}
              options={personOptions}
              placeholder="—"
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("lines")}</CardTitle>
          <CardDescription>{t("allocationHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {lines.map((line, lineIndex) => {
            const preview = previewOf(line);
            return (
              <fieldset
                // Lines are positional: a draft row has no id until it is saved.
                // biome-ignore lint/suspicious/noArrayIndexKey: positional draft rows
                key={lineIndex}
                className="space-y-4 rounded-xl border p-4"
              >
                <legend className="px-1 text-sm font-medium">
                  {t("lineDescription")} {lineIndex + 1}
                </legend>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <TextField
                    label={t("lineDescription")}
                    value={line.description}
                    onChange={(value) => updateLine(lineIndex, { description: value })}
                  />
                  <TextField
                    label={t("lineAmount")}
                    value={line.amountInclTax}
                    inputMode="decimal"
                    placeholder="0,00"
                    onChange={(value) => updateLine(lineIndex, { amountInclTax: value })}
                  />
                  <TextField
                    label={t("lineRecoverable")}
                    value={line.recoverablePercent}
                    inputMode="decimal"
                    onChange={(value) => updateLine(lineIndex, { recoverablePercent: value })}
                  />
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-medium">{t("allocation")}</p>
                  {line.targets.map((target, targetIndex) => (
                    <div
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional draft rows
                      key={targetIndex}
                      className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_8rem_auto]"
                    >
                      <SelectField
                        label={t("target")}
                        value={target.target}
                        onChange={(value) =>
                          updateTarget(lineIndex, targetIndex, {
                            target: value as TargetKind,
                            refId: "",
                          })
                        }
                        options={[
                          { value: "unit", label: t("targetUnit") },
                          { value: "building_common", label: t("targetBuilding") },
                          { value: "entity_common", label: t("targetEntity") },
                        ]}
                      />
                      {target.target === "entity_common" ? (
                        <p className="flex h-9 items-center text-sm text-muted-foreground">
                          {t("targetEntity")}
                        </p>
                      ) : (
                        <SelectField
                          label={target.target === "unit" ? t("targetUnit") : t("targetBuilding")}
                          value={target.refId}
                          onChange={(value) =>
                            updateTarget(lineIndex, targetIndex, { refId: value })
                          }
                          options={target.target === "unit" ? unitOptions : buildingOptions}
                          placeholder="—"
                        />
                      )}
                      <TextField
                        label={t("share")}
                        value={target.sharePercent}
                        inputMode="decimal"
                        onChange={(value) =>
                          updateTarget(lineIndex, targetIndex, { sharePercent: value })
                        }
                      />
                      <div className="flex h-9 items-center gap-3">
                        <span className="num text-sm">
                          <Money amount={preview?.byTarget.get(targetIndex) ?? null} />
                        </span>
                        {line.targets.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              updateLine(lineIndex, {
                                targets: line.targets.filter((_, i) => i !== targetIndex),
                              })
                            }
                          >
                            {t("removeTarget")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  <div className="flex flex-wrap items-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateLine(lineIndex, {
                          targets: [
                            ...line.targets,
                            { target: "unit", refId: "", sharePercent: "0" },
                          ],
                        })
                      }
                    >
                      {t("addTarget")}
                    </Button>
                    <TextField
                      label={t("previewResidual")}
                      value={line.residualPercent}
                      inputMode="decimal"
                      className="w-32 space-y-1.5"
                      onChange={(value) => updateLine(lineIndex, { residualPercent: value })}
                    />
                    <p className="flex h-9 items-center text-sm text-muted-foreground">
                      <Money amount={preview?.residual ?? null} />
                    </p>
                  </div>
                </div>

                {lines.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines(lines.filter((_, i) => i !== lineIndex))}
                  >
                    {t("removeLine")}
                  </Button>
                ) : null}
              </fieldset>
            );
          })}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLines([...lines, emptyLine()])}
            >
              {t("addLine")}
            </Button>
            <p className="text-sm">
              {t("totalInclTax")} :{" "}
              <strong data-testid="expense-total">
                <Money amount={totalInclTax} />
              </strong>
            </p>
          </div>

          {!sharesValid ? (
            <p role="alert" className="text-sm text-destructive">
              {t("sharesInvalid")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={!complete || !sharesValid || save.isPending}>
        {save.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
