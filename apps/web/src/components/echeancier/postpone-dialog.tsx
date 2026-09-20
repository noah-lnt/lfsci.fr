"use client";

import { useTranslations } from "next-intl";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { newDueOn: string; reason: string }) => void;
  pending: boolean;
};

/** TMP-03: a report keeps the initial date and demands a reason. */
export function PostponeDialog({ open, onOpenChange, onConfirm, pending }: Props) {
  const t = useTranslations("echeancier");
  const [newDueOn, setNewDueOn] = useState("");
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("postponeTitle")}</DialogTitle>
          <DialogDescription>{t("reasonPlaceholder")}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm({ newDueOn, reason: reason.trim() });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="postpone-date">{t("newDueOn")}</Label>
            <Input
              id="postpone-date"
              type="date"
              value={newDueOn}
              onChange={(event) => setNewDueOn(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="postpone-reason">{t("reason")}</Label>
            <Textarea
              id="postpone-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">{t("cancel")}</Button>} />
            <Button type="submit" disabled={pending || !newDueOn || reason.trim().length === 0}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
