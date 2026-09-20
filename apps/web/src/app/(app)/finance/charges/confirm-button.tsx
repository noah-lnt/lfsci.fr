"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  label: string;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  disabled?: boolean;
  testId?: string;
  onConfirm: () => void;
};

/** House rule: a destructive action is confirmed before it runs. */
export function ConfirmButton({
  label,
  title,
  body,
  cancelLabel,
  confirmLabel,
  disabled,
  testId,
  onConfirm,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">{cancelLabel}</Button>} />
            <Button
              variant="destructive"
              data-testid={testId ? `${testId}-confirm` : undefined}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
