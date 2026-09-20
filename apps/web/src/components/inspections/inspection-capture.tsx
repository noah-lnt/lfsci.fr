"use client";

import type {
  InspectionFinding,
  InspectionFindingCondition,
  InventoryItem,
  InventoryItemCondition,
} from "@lfsci/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { UploadPanel } from "@/components/documents/upload-panel";
import { ErrorBox } from "@/components/feedback/error-box";
import { ScrollRegion } from "@/components/finance/scroll-region";
import { PageNav } from "@/components/layout/page-nav";
import { Field, SectionTitle, SelectField } from "@/components/locations/ui";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/ui/link-button";
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
import { Textarea } from "@/components/ui/textarea";
import type { InspectionDetail } from "@/lib/contracts/inspections";
import { errorPayload, rpc } from "@/lib/rpc";
import { InspectionStatusBadge } from "./ui";

const CONDITIONS = ["new", "good", "fair", "worn", "damaged", "missing", "not_checked"] as const;
const ITEM_CONDITIONS = ["new", "good", "fair", "worn", "damaged", "missing"] as const;
const SEALED = ["signed", "contested", "archived"];
const PRESENCE = ["unknown", "yes", "no"] as const;

type Presence = (typeof PRESENCE)[number];

function presenceOf(value: boolean | null): Presence {
  return value === null ? "unknown" : value ? "yes" : "no";
}

function presenceValue(value: Presence): boolean | null {
  return value === "unknown" ? null : value === "yes";
}

/** A cleared date or text input reads as "", which no nullable field accepts. */
function blankToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value.trim() === "" ? null : value;
}

function FindingCard({
  finding,
  readOnly,
  onChanged,
}: {
  finding: InspectionFinding;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("inspections");
  const [condition, setCondition] = useState<string>(finding.condition ?? "not_checked");
  const [description, setDescription] = useState(finding.description ?? "");

  const save = useMutation({
    mutationFn: () =>
      rpc.inspections.findings.update({
        id: finding.id,
        expectedVersion: finding.version,
        condition: condition as InspectionFinding["condition"],
        description: description.trim() === "" ? null : description.trim(),
      }),
    onSuccess: async () => {
      toast.success(t("capture.saved"));
      await onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      rpc.inspections.findings.remove({ id: finding.id, expectedVersion: finding.version }),
    onSuccess: onChanged,
  });

  const descriptionId = `finding-description-${finding.id}`;

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4" data-testid="finding-card">
      <p className="font-medium">{finding.element}</p>
      <SelectField
        id={`finding-condition-${finding.id}`}
        label={t("capture.condition")}
        value={condition}
        onChange={setCondition}
        disabled={readOnly}
        options={CONDITIONS.map((value) => ({ value, label: t(`condition.${value}`) }))}
      />
      <Field id={descriptionId} label={t("capture.descriptionLabel")}>
        <Textarea
          id={descriptionId}
          rows={2}
          value={description}
          disabled={readOnly}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="h-11 sm:h-8"
          disabled={readOnly || save.isPending}
          onClick={() => save.mutate()}
        >
          <Save aria-hidden="true" />
          {t("capture.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-11 sm:h-8"
          disabled={readOnly || remove.isPending}
          onClick={() => remove.mutate()}
        >
          <Trash2 aria-hidden="true" />
          {t("capture.remove")}
        </Button>
      </div>
      {save.error ? <ErrorBox error={errorPayload(save.error)} /> : null}
      {remove.error ? <ErrorBox error={errorPayload(remove.error)} /> : null}
    </li>
  );
}

function AddFinding({
  inspectionId,
  readOnly,
  onAdded,
}: {
  inspectionId: string;
  readOnly: boolean;
  onAdded: () => Promise<void>;
}) {
  const t = useTranslations("inspections");
  const [room, setRoom] = useState("");
  const [element, setElement] = useState("");
  const [condition, setCondition] = useState<string>("good");
  const [description, setDescription] = useState("");

  const add = useMutation({
    mutationFn: () =>
      rpc.inspections.findings.add({
        inspectionId,
        element: element.trim(),
        condition: condition as InspectionFindingCondition,
        ...(room.trim() ? { room: room.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: async () => {
      setElement("");
      setDescription("");
      await onAdded();
    },
  });

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <SectionTitle>{t("capture.title")}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="finding-room" label={t("capture.room")}>
          <Input
            id="finding-room"
            value={room}
            disabled={readOnly}
            placeholder={t("capture.roomPlaceholder")}
            onChange={(event) => setRoom(event.target.value)}
          />
        </Field>
        <Field id="finding-element" label={t("capture.element")}>
          <Input
            id="finding-element"
            value={element}
            required
            disabled={readOnly}
            placeholder={t("capture.elementPlaceholder")}
            onChange={(event) => setElement(event.target.value)}
          />
        </Field>
        <SelectField
          id="finding-new-condition"
          label={t("capture.condition")}
          value={condition}
          onChange={setCondition}
          disabled={readOnly}
          options={CONDITIONS.map((value) => ({ value, label: t(`condition.${value}`) }))}
        />
        <Field id="finding-new-description" label={t("capture.descriptionLabel")}>
          <Textarea
            id="finding-new-description"
            rows={2}
            value={description}
            disabled={readOnly}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
      <Button
        type="submit"
        className="h-11 w-full sm:h-9 sm:w-auto"
        disabled={readOnly || element.trim() === "" || add.isPending}
      >
        <Plus aria-hidden="true" />
        {t("capture.add")}
      </Button>
      {add.error ? <ErrorBox error={errorPayload(add.error)} /> : null}
    </form>
  );
}

function InventoryPanel({
  leaseId,
  unitId,
  readOnly,
}: {
  leaseId: string;
  unitId: string;
  readOnly: boolean;
}) {
  const t = useTranslations("inspections");
  const client = useQueryClient();
  const [category, setCategory] = useState("");
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<string>("good");
  const [purchaseValue, setPurchaseValue] = useState("");

  const inventory = useQuery({
    queryKey: ["inspections", "inventory", leaseId],
    queryFn: () => rpc.inspections.inventory.list({ leaseId, limit: 100 }),
  });

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["inspections"] });
  };

  const add = useMutation({
    mutationFn: () =>
      rpc.inspections.inventory.add({
        leaseId,
        unitId,
        category: category.trim(),
        label: label.trim(),
        quantity: quantity.replace(",", "."),
        condition: condition as InventoryItemCondition,
        ...(purchaseValue.trim() ? { purchaseValue: purchaseValue.replace(",", ".") } : {}),
      }),
    onSuccess: async () => {
      setLabel("");
      setPurchaseValue("");
      toast.success(t("inventory.saved"));
      await refresh();
    },
  });

  const items = inventory.data?.items ?? [];

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <SectionTitle>{t("inventory.title")}</SectionTitle>
      <p className="text-sm text-muted-foreground">{t("inventory.hint")}</p>

      {inventory.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {inventory.data && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("inventory.empty")}</p>
      ) : null}

      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <InventoryCard key={item.id} item={item} readOnly={readOnly} onChanged={refresh} />
          ))}
        </ul>
      ) : null}

      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate();
        }}
      >
        <Field id="inventory-category" label={t("inventory.category")}>
          <Input
            id="inventory-category"
            value={category}
            required
            disabled={readOnly}
            placeholder={t("inventory.categoryPlaceholder")}
            onChange={(event) => setCategory(event.target.value)}
          />
        </Field>
        <Field id="inventory-label" label={t("inventory.label")}>
          <Input
            id="inventory-label"
            value={label}
            required
            disabled={readOnly}
            placeholder={t("inventory.labelPlaceholder")}
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>
        <Field id="inventory-quantity" label={t("inventory.quantity")}>
          <Input
            id="inventory-quantity"
            className="num"
            inputMode="decimal"
            value={quantity}
            disabled={readOnly}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </Field>
        <SelectField
          id="inventory-condition"
          label={t("inventory.condition")}
          value={condition}
          onChange={setCondition}
          disabled={readOnly}
          options={ITEM_CONDITIONS.map((value) => ({ value, label: t(`condition.${value}`) }))}
        />
        <Field id="inventory-purchase-value" label={t("inventory.purchaseValue")}>
          <Input
            id="inventory-purchase-value"
            className="num"
            inputMode="decimal"
            value={purchaseValue}
            disabled={readOnly}
            onChange={(event) => setPurchaseValue(event.target.value)}
          />
        </Field>
        <div className="sm:col-span-3">
          <Button
            type="submit"
            className="h-11 w-full sm:h-9 sm:w-auto"
            disabled={readOnly || category.trim() === "" || label.trim() === "" || add.isPending}
          >
            <Plus aria-hidden="true" />
            {t("inventory.add")}
          </Button>
        </div>
      </form>
      {add.error ? <ErrorBox error={errorPayload(add.error)} /> : null}
    </section>
  );
}

function InventoryCard({
  item,
  readOnly,
  onChanged,
}: {
  item: InventoryItem;
  readOnly: boolean;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("inspections");
  const presenceOptions = PRESENCE.map((value) => ({
    value,
    label: t(`inventory.${value}`),
  }));

  const update = useMutation({
    mutationFn: (patch: { presentAtEntry?: boolean | null; presentAtExit?: boolean | null }) =>
      rpc.inspections.inventory.update({ id: item.id, expectedVersion: item.version, ...patch }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () =>
      rpc.inspections.inventory.remove({ id: item.id, expectedVersion: item.version }),
    onSuccess: onChanged,
  });

  return (
    <li className="space-y-3 rounded-xl border bg-card p-4" data-testid="inventory-row">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{item.label}</p>
        <p className="text-sm text-muted-foreground">
          {item.category} · <span className="num">{item.quantity}</span> ·{" "}
          <Money amount={item.purchaseValue} currency={item.currency} />
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          id={`inventory-entry-${item.id}`}
          label={`${t("inventory.presentAtEntry")} — ${item.label}`}
          value={presenceOf(item.presentAtEntry)}
          disabled={readOnly || update.isPending}
          options={presenceOptions}
          onChange={(value) => update.mutate({ presentAtEntry: presenceValue(value as Presence) })}
        />
        <SelectField
          id={`inventory-exit-${item.id}`}
          label={`${t("inventory.presentAtExit")} — ${item.label}`}
          value={presenceOf(item.presentAtExit)}
          disabled={readOnly || update.isPending}
          options={presenceOptions}
          onChange={(value) => update.mutate({ presentAtExit: presenceValue(value as Presence) })}
        />
      </div>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="h-11 sm:h-8"
        disabled={readOnly || remove.isPending}
        onClick={() => remove.mutate()}
      >
        <Trash2 aria-hidden="true" />
        {t("inventory.remove")}
      </Button>
      {update.error ? <ErrorBox error={errorPayload(update.error)} /> : null}
      {remove.error ? <ErrorBox error={errorPayload(remove.error)} /> : null}
    </li>
  );
}

function PhotoIndex({ photos }: { photos: InspectionDetail["photos"] }) {
  const t = useTranslations("inspections.photos");
  if (photos.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <ScrollRegion label={t("title")}>
      <Table>
        <caption className="sr-only">{t("title")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("title")}</TableHead>
            <TableHead scope="col">{t("author")}</TableHead>
            <TableHead scope="col">{t("capturedAt")}</TableHead>
            <TableHead scope="col">{t("receivedAt")}</TableHead>
            <TableHead scope="col">{t("fingerprint")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {photos.map((photo) => (
            <TableRow key={photo.documentId} data-testid="photo-row">
              <TableCell>{photo.title}</TableCell>
              <TableCell>{photo.authorName ?? t("unknownAuthor")}</TableCell>
              <TableCell>
                <DateValue value={photo.capturedAt} withTime />
                {photo.metadataMissing ? (
                  <span className="block text-xs text-warning">{t("metadataMissing")}</span>
                ) : null}
              </TableCell>
              <TableCell>
                <DateValue value={photo.receivedAt} withTime />
              </TableCell>
              <TableCell className="num text-xs">{photo.sha256.slice(0, 12)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  );
}

export function InspectionCapture({
  leaseId,
  inspectionId,
}: {
  leaseId: string;
  inspectionId: string;
}) {
  const t = useTranslations("inspections");
  const client = useQueryClient();
  const router = useRouter();

  const inspection = useQuery({
    queryKey: ["inspections", "detail", inspectionId],
    queryFn: () => rpc.inspections.get({ id: inspectionId }),
  });

  const [performedOn, setPerformedOn] = useState<string | null>(null);
  const [keysHandedOverOn, setKeysHandedOverOn] = useState<string | null>(null);
  const [heating, setHeating] = useState<string | null>(null);
  const [signatureEvidence, setSignatureEvidence] = useState<string | null>(null);

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["inspections"] });
  };

  const data = inspection.data;

  const save = useMutation({
    mutationFn: (status?: "signed") =>
      rpc.inspections.update({
        id: inspectionId,
        expectedVersion: data?.version ?? 1,
        performedOn: blankToNull(performedOn ?? data?.performedOn),
        keysHandedOverOn: blankToNull(keysHandedOverOn ?? data?.keysHandedOverOn),
        heatingComplementDeadlineOn: blankToNull(heating ?? data?.heatingComplementDeadlineOn),
        signatureEvidence: blankToNull(signatureEvidence ?? data?.signatureEvidence),
        ...(status ? { status } : {}),
      }),
    onSuccess: async (updated) => {
      toast.success(updated.status === "signed" ? t("capture.signed") : t("capture.saved"));
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      rpc.inspections.remove({ id: inspectionId, expectedVersion: data?.version ?? 1 }),
    onSuccess: async () => {
      await refresh();
      router.push(`/locations/baux/${leaseId}/etats-des-lieux`);
    },
  });

  if (inspection.error) return <ErrorBox error={errorPayload(inspection.error)} />;
  if (!data) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  const readOnly = SEALED.includes(data.status);
  const rooms = [...new Set(data.findings.map((finding) => finding.room ?? ""))];

  return (
    <div className="space-y-6">
      <PageNav
        title={`${t(`kind.${data.kind}`)} · ${data.unitLabel}`}
        description={data.leaseReference}
        icon={<ClipboardList className="size-5" aria-hidden="true" />}
      >
        <InspectionStatusBadge status={data.status} />
        <LinkButton href={`/locations/baux/${leaseId}/etats-des-lieux`} variant="outline" size="sm">
          <ArrowLeft aria-hidden="true" />
          {t("backToList")}
        </LinkButton>
      </PageNav>

      {readOnly ? (
        <p className="rounded-xl border bg-card p-4 text-sm" role="status">
          {t("capture.sealed")}
        </p>
      ) : null}

      {data.complementDeadlineOn ? (
        <p
          className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
          data-testid="complement-notice"
        >
          {t("capture.complementNotice", { date: data.complementDeadlineOn })}
        </p>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("capture.title")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="visit-performed-on" label={t("capture.performedOn")}>
            <Input
              id="visit-performed-on"
              type="date"
              value={performedOn ?? data.performedOn ?? ""}
              disabled={readOnly}
              onChange={(event) => setPerformedOn(event.target.value)}
            />
          </Field>
          <Field id="visit-keys" label={t("capture.keysHandedOverOn")}>
            <Input
              id="visit-keys"
              type="date"
              value={keysHandedOverOn ?? data.keysHandedOverOn ?? ""}
              disabled={readOnly}
              onChange={(event) => setKeysHandedOverOn(event.target.value)}
            />
          </Field>
          <Field
            id="visit-heating"
            label={t("capture.heatingComplement")}
            hint={t("capture.heatingHint")}
          >
            <Input
              id="visit-heating"
              type="date"
              value={heating ?? data.heatingComplementDeadlineOn ?? ""}
              disabled={readOnly}
              onChange={(event) => setHeating(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-3">
            <Field
              id="visit-signature"
              label={t("capture.signatureEvidence")}
              hint={t("capture.signatureHint")}
            >
              <Input
                id="visit-signature"
                value={signatureEvidence ?? data.signatureEvidence ?? ""}
                disabled={readOnly}
                onChange={(event) => setSignatureEvidence(event.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="h-11 sm:h-9"
            disabled={readOnly || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            <Save aria-hidden="true" />
            {t("capture.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            data-testid="sign-inspection"
            disabled={readOnly || save.isPending}
            onClick={() => save.mutate("signed")}
          >
            {t("capture.sign")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 sm:h-9"
            disabled={readOnly || remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 aria-hidden="true" />
            {t("capture.deleteInspection")}
          </Button>
        </div>
        {save.error ? <ErrorBox error={errorPayload(save.error)} /> : null}
        {remove.error ? <ErrorBox error={errorPayload(remove.error)} /> : null}
      </section>

      <AddFinding inspectionId={inspectionId} readOnly={readOnly} onAdded={refresh} />

      <section className="space-y-4">
        <SectionTitle>{t("capture.findingsTitle")}</SectionTitle>
        {data.findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("capture.empty")}</p>
        ) : null}
        {rooms.map((room) => (
          <section key={room} className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">{room || "—"}</h3>
            <ul className="space-y-3">
              {data.findings
                .filter((finding) => (finding.room ?? "") === room)
                .map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    readOnly={readOnly}
                    onChanged={refresh}
                  />
                ))}
            </ul>
          </section>
        ))}
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("photos.title")}</SectionTitle>
        <UploadPanel
          object={{ kind: "inspection", id: inspectionId }}
          onUploaded={() => {
            void refresh();
          }}
        />
        <PhotoIndex photos={data.photos} />
      </section>

      <InventoryPanel leaseId={leaseId} unitId={data.unitId} readOnly={readOnly} />
    </div>
  );
}
