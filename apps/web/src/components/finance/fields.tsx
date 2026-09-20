"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type Option = { value: string; label: string };

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
  className?: string;
};

export function TextField({
  label,
  value,
  onChange,
  required,
  hint,
  type = "text",
  inputMode,
  placeholder,
  className,
}: FieldProps & {
  type?: "text" | "date" | "number";
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        required={required}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-describedby={hint ? hintId : undefined}
        className={inputMode === "decimal" ? "num" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField({ label, value, onChange, required, className }: FieldProps) {
  const id = useId();
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** ux.md: never a native `<select>` in an application form. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
}: FieldProps & { options: readonly Option[]; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={className ?? "space-y-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      <Select
        items={options.map((option) => ({ label: option.label, value: option.value }))}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onChange(next === null ? "" : String(next))}
      >
        <SelectTrigger id={id} className="h-9 w-full">
          <SelectValue placeholder={placeholder ?? ""} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function optionsFrom(entries: Record<string, string>, keys: readonly string[]): Option[] {
  return keys.map((key) => ({ value: key, label: entries[key] ?? key }));
}
