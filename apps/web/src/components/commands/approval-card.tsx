"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { Textarea } from "@/components/ui/textarea";
import type { PendingApproval } from "@/lib/contracts/commands";

type Props = {
  approval: PendingApproval;
  pending: boolean;
  onDecide: (input: { decision: "approved" | "refused"; reason?: string }) => void;
};

/** IA-03: pieces, expected effect, and a refusal that must be motivated. */
export function ApprovalCard({ approval, pending, onDecide }: Props) {
  const t = useTranslations("validations");
  const [reason, setReason] = useState("");
  const reasonId = `refusal-${approval.commandId}`;

  return (
    <li
      id={approval.commandId}
      data-testid="approval-card"
      className="rounded-xl border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{approval.what}</h3>
        <Badge variant="outline">
          {t("level")} {approval.level}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          <DateValue value={approval.createdAt} withTime />
        </span>
      </div>

      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t("amount")}</dt>
        <dd>
          <Money amount={approval.amount} currency={approval.currency} />
        </dd>
        <dt className="text-muted-foreground">{t("pieces")}</dt>
        <dd>{approval.pieces.length > 0 ? approval.pieces.join(" · ") : "—"}</dd>
        <dt className="text-muted-foreground">{t("effect")}</dt>
        <dd>{approval.expectedEffect}</dd>
      </dl>

      <div className="mt-3 space-y-1.5">
        <Label htmlFor={reasonId}>{t("reason")}</Label>
        <Textarea
          id={reasonId}
          rows={2}
          placeholder={t("reasonPlaceholder")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{t("expiryNotice")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => onDecide({ decision: "approved" })}>
          {t("approve")}
        </Button>
        <Button
          variant="destructive"
          disabled={pending || reason.trim().length === 0}
          onClick={() => onDecide({ decision: "refused", reason: reason.trim() })}
        >
          {t("refuse")}
        </Button>
      </div>
    </li>
  );
}
