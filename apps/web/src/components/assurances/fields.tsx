"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";

type Props = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/** The house checkbox renders a `span[role=checkbox]`, which `htmlFor` cannot label. */
export function CheckboxField({ label, checked, onChange }: Props) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        aria-labelledby={`${id}-label`}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span id={`${id}-label`} className="text-sm">
        {label}
      </span>
    </div>
  );
}
