"use client";

import type { ErrorPayload } from "@lfsci/contracts";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "../ui/button";

type Props = { error: ErrorPayload };

export function ErrorBox({ error }: Props) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium text-foreground">{error.message}</p>
        <p className="num text-xs text-muted-foreground">
          {t("reference")} : <span data-testid="error-request-id">{error.requestId}</span>
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("copy")}
        onClick={async () => {
          await navigator.clipboard.writeText(error.requestId);
          setCopied(true);
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}
