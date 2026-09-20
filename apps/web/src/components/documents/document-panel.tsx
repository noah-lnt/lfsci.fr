"use client";

import type { DocumentEntity, ErrorPayload, ObjectRef } from "@lfsci/contracts";
import { useMutation } from "@tanstack/react-query";
import { Download, FileText, Image as ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateValue } from "@/components/ui/date";
import { errorPayload, rpc } from "@/lib/rpc";
import { UploadPanel } from "./upload-panel";

const PAGE_SIZE = 20;

export type DocumentFilters = {
  nature?: string;
  search?: string;
  periodFrom?: string;
  periodTo?: string;
};

function sizeLabel(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

type Props = { object?: ObjectRef; filters?: DocumentFilters };

export function DocumentPanel({ object, filters }: Props) {
  const t = useTranslations("documents");
  const [items, setItems] = useState<DocumentEntity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const key = JSON.stringify(filters ?? {});

  const load = useMutation({
    mutationFn: async (from: string | null) =>
      rpc.documents.list({
        limit: PAGE_SIZE,
        ...(from ? { cursor: from } : {}),
        ...(object ? { object } : {}),
        ...(filters?.nature ? { nature: filters.nature } : {}),
        ...(filters?.search ? { search: filters.search } : {}),
        ...(filters?.periodFrom ? { periodFrom: filters.periodFrom } : {}),
        ...(filters?.periodTo ? { periodTo: filters.periodTo } : {}),
      }),
    onSuccess: (result, from) => {
      setItems((current) => (from ? [...current, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setLoaded(true);
      setError(null);
    },
    onError: (cause) => {
      setLoaded(true);
      setError(errorPayload(cause));
    },
  });

  const { mutate } = load;
  const reload = useCallback(() => mutate(null), [mutate]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the serialized filter set.
  useEffect(() => {
    reload();
  }, [reload, key]);

  const download = useMutation({
    mutationFn: async (id: string) => rpc.documents.download({ id }),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (cause) => setError(errorPayload(cause)),
  });

  const natures = t.raw("nature") as Record<string, string>;

  return (
    <div className="space-y-4">
      <UploadPanel {...(object ? { object } : {})} onUploaded={reload} />

      {error ? <ErrorBox error={error} /> : null}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card" data-testid="document-list">
          {items.map((document) => {
            const contentType = document.currentVersion?.detectedType ?? "";
            return (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-3 p-3"
                data-testid="document-row"
              >
                {contentType.startsWith("image/") ? (
                  <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-40 flex-1 font-medium">{document.title}</span>
                <Badge variant="outline">{natures[document.nature] ?? document.nature}</Badge>
                <span className="num text-sm text-muted-foreground">
                  {sizeLabel(document.currentVersion?.byteSize)}
                </span>
                <DateValue value={document.createdAt} className="text-sm text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {document.links.length === 0
                    ? "—"
                    : document.links.map((link) => link.object.kind).join(", ")}
                </span>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 sm:h-9"
                  disabled={download.isPending || document.currentVersion === null}
                  onClick={() => download.mutate(document.id)}
                >
                  <Download aria-hidden="true" />
                  {download.isPending ? t("downloading") : t("download")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        variant="outline"
        size="lg"
        className="h-11 sm:h-9"
        disabled={cursor === null || load.isPending}
        onClick={() => mutate(cursor)}
      >
        {t("loadMore")}
      </Button>
    </div>
  );
}
