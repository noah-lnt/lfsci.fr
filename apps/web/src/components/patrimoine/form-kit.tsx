"use client";

import { type ReactNode, useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** 44 px targets on touch, the compact desktop height above `sm` (UX-03). */
export const CONTROL = "h-11 w-full sm:h-9";

type FieldProps = {
  label: string;
  hint?: string;
  errors?: readonly unknown[];
  children: (ids: { id: string; labelId: string; describedBy: string | undefined }) => ReactNode;
};

function messageOf(issue: unknown): string {
  if (typeof issue === "string") return issue;
  const message = (issue as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "Valeur invalide.";
}

export function Field({ label, hint, errors, children }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const failed = (errors?.length ?? 0) > 0;
  const describedBy = [hint ? hintId : null, failed ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="space-y-1.5">
      <Label id={labelId} htmlFor={id}>
        {label}
      </Label>
      {children({ id, labelId, describedBy: describedBy || undefined })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {failed ? (
        <p id={errorId} className="text-xs text-destructive">
          {errors?.map(messageOf).join(" ")}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  type?: "text" | "date" | "number";
  placeholder?: string;
  hint?: string;
  errors?: readonly unknown[];
  required?: boolean;
};

export function TextField({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  placeholder,
  hint,
  errors,
  required,
}: TextFieldProps) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} {...(errors ? { errors } : {})}>
      {({ id, describedBy }) => (
        <Input
          id={id}
          type={type}
          className={CONTROL}
          value={value}
          required={required ?? false}
          aria-invalid={(errors?.length ?? 0) > 0}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
          {...(placeholder ? { placeholder } : {})}
          onChange={(event) => onChange(event.target.value)}
          {...(onBlur ? { onBlur } : {})}
        />
      )}
    </Field>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
  hint?: string;
  errors?: readonly unknown[];
};

export function SelectField({ label, value, options, onChange, hint, errors }: SelectFieldProps) {
  return (
    <Field label={label} {...(hint ? { hint } : {})} {...(errors ? { errors } : {})}>
      {({ id, labelId, describedBy }) => (
        <Select items={options} value={value} onValueChange={(next) => onChange(String(next))}>
          <SelectTrigger
            id={id}
            aria-labelledby={labelId}
            aria-invalid={(errors?.length ?? 0) > 0}
            className={CONTROL}
            {...(describedBy ? { "aria-describedby": describedBy } : {})}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(options).map(([key, text]) => (
              <SelectItem key={key} value={key}>
                {text}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/** One column on a phone, two from `sm`: every form on this feature uses it. */
export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

type FieldErrors = { fields: Record<string, string> };

/**
 * Runs the contract schema over the mapped form values and returns the first
 * issue per field, so the error appears under the field that caused it.
 */
export function validateWith<Values>(
  schema: {
    safeParse: (value: unknown) => {
      success: boolean;
      error?: { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
    };
  },
  map: (values: Values) => unknown,
) {
  return ({ value }: { value: Values }): FieldErrors | undefined => {
    const parsed = schema.safeParse(map(value));
    if (parsed.success) return undefined;
    const fields: Record<string, string> = {};
    for (const issue of parsed.error?.issues ?? []) {
      const key = issue.path[0];
      if (typeof key === "string" && fields[key] === undefined) fields[key] = issue.message;
    }
    return { fields };
  };
}

/** An empty text input means "not provided", never an empty string. */
export function trimmed(value: string): string | undefined {
  const cleaned = value.trim();
  return cleaned === "" ? undefined : cleaned;
}

export function numeric(value: string): number | undefined {
  const cleaned = value.trim();
  if (cleaned === "") return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
