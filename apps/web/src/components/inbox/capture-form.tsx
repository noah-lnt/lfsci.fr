"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorBox } from "@/components/feedback/error-box";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorPayload, rpc } from "@/lib/rpc";

/** CAP-01/CAP-02: a note or a pasted SMS enters the inbox without choosing a lot. */
export function CaptureForm() {
  const t = useTranslations("inbox");
  const [text, setText] = useState("");
  const queryClient = useQueryClient();

  const capture = useMutation({
    mutationFn: (content: string) => rpc.inbox.captureNote({ text: content, channel: "note" }),
    onSuccess: async () => {
      setText("");
      toast.success(t("captured"));
      await queryClient.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  return (
    <form
      className="space-y-2 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        capture.mutate(text.trim());
      }}
    >
      <h2 className="text-sm font-medium">{t("captureTitle")}</h2>
      <Label htmlFor="inbox-capture">{t("captureText")}</Label>
      <Textarea
        id="inbox-capture"
        name="text"
        rows={3}
        placeholder={t("captureTextPlaceholder")}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {capture.error ? <ErrorBox error={errorPayload(capture.error)} /> : null}
      <Button type="submit" disabled={capture.isPending || text.trim().length === 0}>
        <Camera aria-hidden="true" />
        {t("captureSubmit")}
      </Button>
    </form>
  );
}
