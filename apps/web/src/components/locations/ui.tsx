"use client";

import { cn } from "cn";
import {
  Archive,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  FilePen,
  FileSignature,
  FileText,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeaseListItem, Settlement } from "@/lib/contracts/locations";

type FieldProps = {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
};

/** Visible label, control, then the error under the field (house UX rules). */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
};

export function SelectField({
  id,
  label,
  value,
  options,
  onChange,
  hint,
  error,
  disabled,
}: SelectFieldProps) {
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]));
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

const LEASE_STATUS_ICON = {
  draft: FileText,
  ready_to_sign: FilePen,
  signed: FileSignature,
  active: CircleCheck,
  terminated: CircleSlash,
  archived: Archive,
  cancelled: Ban,
  disputed: TriangleAlert,
} as const;

type LeaseStatusValue = LeaseListItem["status"];

/** Colour never carries the meaning alone: every badge holds an icon and a label. */
export function LeaseStatusBadge({ status }: { status: LeaseStatusValue }) {
  const t = useTranslations("locations.status");
  const Icon = LEASE_STATUS_ICON[status];
  const variant =
    status === "active" ? "default" : status === "disputed" ? "destructive" : "outline";
  return (
    <Badge variant={variant} className="gap-1" data-testid="lease-status">
      <Icon aria-hidden="true" />
      {t(status)}
    </Badge>
  );
}

const SETTLEMENT_ICON = { unpaid: CircleX, partial: CircleDashed, paid: CircleCheck } as const;

export function SettlementBadge({ settlement }: { settlement: Settlement }) {
  const t = useTranslations("locations.settlement");
  const Icon = SETTLEMENT_ICON[settlement];
  return (
    <Badge
      variant={
        settlement === "paid" ? "default" : settlement === "unpaid" ? "destructive" : "outline"
      }
      className="gap-1"
    >
      <Icon aria-hidden="true" />
      {t(settlement)}
    </Badge>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-sm font-semibold tracking-tight", className)}>{children}</h2>;
}

export function DefinitionList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
