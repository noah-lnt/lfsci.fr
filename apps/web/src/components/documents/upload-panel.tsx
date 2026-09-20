"use client";

import type { ObjectRef } from "@lfsci/contracts";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorPayload } from "@/lib/rpc";
import { UploadRejected, useUploadQueue } from "./upload-queue";

type Props = { object?: ObjectRef; onUploaded: () => void };

/**
 * CAP-01: the capture control sits in the page flow (no floating button) and
 * says where the file is — "enregistré sur cet appareil" then "synchronisé".
 */
export function UploadPanel({ object, onUploaded }: Props) {
  const t = useTranslations("documents");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const queue = useUploadQueue({
    nature: "to_qualify",
    ...(object ? { object, relation: "attached" as const } : {}),
  });

  const labels = t.raw("queue") as Record<string, string>;

  async function accept(files: FileList | null): Promise<void> {
    for (const file of Array.from(files ?? [])) {
      try {
        await queue.enqueue(file);
        onUploaded();
      } catch (cause) {
        if (cause instanceof UploadRejected) {
          toast.error(t(`errors.${cause.reason}`));
          continue;
        }
        const payload = errorPayload(cause);
        toast.error(payload.message);
      }
    }
  }

  return (
    <section className="space-y-3" aria-label={t("add")}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is an
          enhancement; the labelled button below is the keyboard and pointer
          path, which is the drag alternative WCAG 2.2 asks for. */}
      <div
        role="presentation"
        className={`rounded-xl border border-dashed p-4 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "bg-card"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void accept(event.dataTransfer.files);
        }}
      >
        <p className="text-sm text-muted-foreground">{t("dropzone")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("accepted")}</p>

        {/* Mobile capture and desktop picker are the same control (tech pack §8). */}
        <label htmlFor={inputId} className="sr-only">
          {t("add")}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={(event) => {
            void accept(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="lg"
          className="mt-3 h-11 sm:h-9"
          onClick={() => inputRef.current?.click()}
        >
          <Upload aria-hidden="true" />
          {t("choose")}
        </Button>
      </div>

      {queue.items.length === 0 ? null : (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <h3 className="text-sm font-semibold">{labels.title}</h3>
          {queue.unsynced > 0 ? (
            <p className="text-xs text-destructive" role="status">
              {t("queue.pendingWarning", { count: queue.unsynced })} {labels.memoryOnly}
            </p>
          ) : null}
          <ul className="space-y-1 text-sm" data-testid="upload-queue">
            {queue.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.filename}</span>
                <span className="text-muted-foreground">{labels[item.state]}</span>
                {item.state === "failed" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void queue.retry(item.id).then(onUploaded);
                    }}
                  >
                    {labels.retry}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
