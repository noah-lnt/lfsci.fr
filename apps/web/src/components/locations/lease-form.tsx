"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreateLeaseFormInput } from "@/lib/contracts/locations";
import { errorPayload, rpc } from "@/lib/rpc";
import { Field, SectionTitle, SelectField } from "./ui";

const LEASE_KINDS = [
  "bare",
  "furnished",
  "mobility",
  "parking",
  "commercial",
  "professional",
  "tourist",
  "other",
] as const;
const CHARGE_REGIMES = ["provision", "flat_fee", "none", "real_expenses"] as const;
const REVISION_INDEXES = ["irl", "ilc", "ilat", "none"] as const;

const QUARTER = /^\d{4}-[QT][1-4]$/;
const MONEY = /^\d{1,12}([.,]\d{1,2})?$/;

type Errors = Record<string, string | undefined>;

function money(value: string): string {
  return value.replace(",", ".");
}

export function LeaseForm() {
  const t = useTranslations("locations");
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});

  const [tenantMode, setTenantMode] = useState("new");
  const [personId, setPersonId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [unitId, setUnitId] = useState("");
  const [reference, setReference] = useState("");
  const [kind, setKind] = useState("bare");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [rent, setRent] = useState("");
  const [chargeRegime, setChargeRegime] = useState("provision");
  const [chargeAmount, setChargeAmount] = useState("");
  const [paymentDay, setPaymentDay] = useState("1");
  const [deposit, setDeposit] = useState("");
  const [revisionIndex, setRevisionIndex] = useState("irl");
  const [referenceQuarter, setReferenceQuarter] = useState("");
  const [revisionMonth, setRevisionMonth] = useState("");
  const [solidarity, setSolidarity] = useState(false);

  const units = useQuery({
    queryKey: ["locations", "units"],
    queryFn: () => rpc.locations.units.options({}),
  });
  const persons = useQuery({
    queryKey: ["locations", "persons", "options"],
    queryFn: () => rpc.locations.persons.list({ limit: 200 }),
  });

  const create = useMutation({
    mutationFn: (input: CreateLeaseFormInput) => rpc.locations.leases.create(input),
    onSuccess: (lease) => {
      toast.success(t("form.created"));
      router.push(`/locations/baux/${lease.id}`);
    },
  });

  function validate(): CreateLeaseFormInput | null {
    const next: Errors = {};
    const required = t("form.required");
    if (tenantMode === "existing" && !personId) next.tenant = required;
    if (tenantMode === "new" && !displayName) next.displayName = required;
    if (!unitId) next.unit = required;
    if (!reference) next.reference = required;
    if (!startsOn) next.startsOn = required;
    if (!MONEY.test(rent)) next.rent = required;
    if (chargeRegime !== "none" && chargeAmount !== "" && !MONEY.test(chargeAmount)) {
      next.chargeAmount = required;
    }
    if (deposit !== "" && !MONEY.test(deposit)) next.deposit = required;
    if (revisionIndex !== "none" && !QUARTER.test(referenceQuarter)) {
      next.referenceQuarter = t("form.invalidQuarter");
    }
    setErrors(next);
    if (Object.values(next).some(Boolean)) return null;

    const contactPoints = [
      ...(email ? [{ kind: "email" as const, value: email, isPrimary: true }] : []),
      ...(phone ? [{ kind: "mobile" as const, value: phone }] : []),
    ];

    return {
      reference,
      kind: kind as CreateLeaseFormInput["kind"],
      startsOn,
      ...(endsOn ? { endsOn } : {}),
      rentExclCharges: money(rent),
      chargeRegime: chargeRegime as CreateLeaseFormInput["chargeRegime"],
      ...(chargeAmount ? { chargeAmount: money(chargeAmount) } : {}),
      ...(deposit ? { depositAmount: money(deposit) } : {}),
      paymentDay: Number(paymentDay),
      ...(revisionIndex !== "none"
        ? {
            revisionIndex: revisionIndex as "irl",
            revisionReferenceQuarter: referenceQuarter.toUpperCase().replace("T", "Q"),
            ...(revisionMonth ? { revisionMonth: Number(revisionMonth) } : {}),
          }
        : {}),
      solidarity,
      parties: [
        tenantMode === "existing"
          ? { personId, role: "holder" as const, startsOn, isBillingContact: true }
          : {
              person: {
                kind: "natural" as const,
                displayName,
                ...(firstName ? { firstName } : {}),
                ...(lastName ? { lastName } : {}),
                ...(contactPoints.length > 0 ? { contactPoints } : {}),
              },
              role: "holder" as const,
              startsOn,
              isBillingContact: true,
            },
      ],
      units: [{ unitId, role: "main" as const }],
    };
  }

  return (
    <form
      className="space-y-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const input = validate();
        if (input) create.mutate(input);
      }}
    >
      {create.error ? <ErrorBox error={errorPayload(create.error)} /> : null}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("form.sectionTenant")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="tenant-mode"
            label={t("form.tenantChoice")}
            value={tenantMode}
            onChange={setTenantMode}
            options={[
              { value: "new", label: t("form.newTenant") },
              { value: "existing", label: t("form.existingTenant") },
            ]}
          />
          {tenantMode === "existing" ? (
            <SelectField
              id="tenant-person"
              label={t("form.tenantPick")}
              value={personId}
              onChange={setPersonId}
              error={errors.tenant}
              options={(persons.data?.items ?? []).map((person) => ({
                value: person.id,
                label: person.displayName,
              }))}
            />
          ) : (
            <Field id="tenant-name" label={t("form.displayName")} error={errors.displayName}>
              <Input
                id="tenant-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
          )}
        </div>
        {tenantMode === "new" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tenant-first-name" label={t("form.firstName")}>
              <Input
                id="tenant-first-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field id="tenant-last-name" label={t("form.lastName")}>
              <Input
                id="tenant-last-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
            <Field id="tenant-email" label={t("form.email")}>
              <Input
                id="tenant-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field id="tenant-phone" label={t("form.phone")}>
              <Input
                id="tenant-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("form.sectionUnit")}</SectionTitle>
        <SelectField
          id="lease-unit"
          label={t("form.unit")}
          value={unitId}
          onChange={setUnitId}
          error={errors.unit}
          options={(units.data?.items ?? []).map((unit) => ({
            value: unit.id,
            label: `${unit.label} · ${unit.buildingName}`,
          }))}
        />
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("form.sectionContract")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="lease-reference" label={t("form.reference")} error={errors.reference}>
            <Input
              id="lease-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
          <SelectField
            id="lease-kind"
            label={t("form.kind")}
            value={kind}
            onChange={setKind}
            options={LEASE_KINDS.map((value) => ({ value, label: t(`leaseKind.${value}`) }))}
          />
          <Field id="lease-starts-on" label={t("form.startsOn")} error={errors.startsOn}>
            <Input
              id="lease-starts-on"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </Field>
          <Field id="lease-ends-on" label={t("form.endsOn")}>
            <Input
              id="lease-ends-on"
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("form.sectionRent")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="lease-rent" label={t("form.rentExclCharges")} error={errors.rent}>
            <Input
              id="lease-rent"
              inputMode="decimal"
              value={rent}
              onChange={(event) => setRent(event.target.value)}
            />
          </Field>
          <SelectField
            id="lease-charge-regime"
            label={t("form.chargeRegime")}
            value={chargeRegime}
            onChange={setChargeRegime}
            options={CHARGE_REGIMES.map((value) => ({
              value,
              label: t(`chargeRegime.${value}`),
            }))}
          />
          <Field
            id="lease-charge-amount"
            label={t("form.chargeAmount")}
            error={errors.chargeAmount}
          >
            <Input
              id="lease-charge-amount"
              inputMode="decimal"
              disabled={chargeRegime === "none"}
              value={chargeAmount}
              onChange={(event) => setChargeAmount(event.target.value)}
            />
          </Field>
          <Field id="lease-payment-day" label={t("form.paymentDay")}>
            <Input
              id="lease-payment-day"
              type="number"
              min={1}
              max={31}
              value={paymentDay}
              onChange={(event) => setPaymentDay(event.target.value)}
            />
          </Field>
          <Field id="lease-deposit" label={t("form.depositAmount")} error={errors.deposit}>
            <Input
              id="lease-deposit"
              inputMode="decimal"
              value={deposit}
              onChange={(event) => setDeposit(event.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <SectionTitle>{t("form.sectionRevision")}</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="lease-revision-index"
            label={t("form.revisionIndexLabel")}
            value={revisionIndex}
            onChange={setRevisionIndex}
            options={REVISION_INDEXES.map((value) => ({
              value,
              label: t(`revisionIndex.${value}`),
            }))}
          />
          <Field
            id="lease-reference-quarter"
            label={t("form.referenceQuarter")}
            hint={t("form.referenceQuarterHint")}
            error={errors.referenceQuarter}
          >
            <Input
              id="lease-reference-quarter"
              placeholder="2025-T2"
              disabled={revisionIndex === "none"}
              value={referenceQuarter}
              onChange={(event) => setReferenceQuarter(event.target.value)}
            />
          </Field>
          <Field id="lease-revision-month" label={t("form.revisionMonth")}>
            <Input
              id="lease-revision-month"
              type="number"
              min={1}
              max={12}
              disabled={revisionIndex === "none"}
              value={revisionMonth}
              onChange={(event) => setRevisionMonth(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="lease-solidarity"
            checked={solidarity}
            onCheckedChange={(checked) => setSolidarity(checked === true)}
          />
          <Label htmlFor="lease-solidarity">{t("form.solidarity")}</Label>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? t("saving") : t("form.submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/locations")}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
