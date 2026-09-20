"use client";

import type { ErrorPayload, ObjectRef, TimelineItem } from "@lfsci/contracts";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/components/ui/date";
import { errorPayload, rpc } from "@/lib/rpc";

const PAGE_SIZE = 20;

function occurredAt(item: TimelineItem): string {
  if (item.itemKind === "activity") return item.activity.occurredAt;
  if (item.itemKind === "event") return item.event.occurredAt;
  return `${item.deadline.dueOn}T00:00:00Z`;
}

function sourceId(item: TimelineItem): string {
  if (item.itemKind === "activity") return item.activity.id;
  if (item.itemKind === "event") return item.event.id;
  return item.deadline.id;
}

function day(value: string): string {
  return value.slice(0, 10);
}

export function TimelinePanel({ object }: { object: ObjectRef }) {
  const t = useTranslations("patrimoine");
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ErrorPayload | null>(null);

  const load = useMutation({
    mutationFn: async (from: string | null) =>
      rpc.patrimoine.timeline({
        object,
        limit: PAGE_SIZE,
        ...(from ? { cursor: from } : {}),
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
  const loadFirst = useCallback(() => mutate(null), [mutate]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  const eventLabels = t.raw("timeline.events") as Record<string, string>;
  const title = (item: TimelineItem): string => {
    if (item.itemKind === "event") return eventLabels[item.event.type] ?? item.event.type;
    if (item.itemKind === "deadline") return item.deadline.title;
    return item.activity.subject ?? t("timeline.activity");
  };

  const groups: { day: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const key = day(occurredAt(item));
    const last = groups.at(-1);
    if (last && last.day === key) last.items.push(item);
    else groups.push({ day: key, items: [item] });
  }

  return (
    <div className="space-y-4" data-testid="timeline">
      {error ? <ErrorBox error={error} /> : null}

      {!loaded ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("timeline.empty")}</p>
      ) : (
        <ol className="space-y-6">
          {groups.map((group) => (
            <li key={group.day} className="space-y-2">
              <h3 className="num text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {formatDate(group.day)}
              </h3>
              <ul className="space-y-2 border-l pl-4">
                {group.items.map((item) => (
                  <li
                    key={`${item.itemKind}-${sourceId(item)}`}
                    className="flex flex-wrap items-center gap-2 text-sm"
                    data-testid="timeline-item"
                  >
                    <Badge variant={item.itemKind === "deadline" ? "outline" : "secondary"}>
                      {item.itemKind === "deadline"
                        ? t("timeline.deadline")
                        : item.itemKind === "activity"
                          ? t("timeline.activity")
                          : t("tabs.timeline")}
                    </Badge>
                    <span className="font-medium">{title(item)}</span>
                    <time className="num text-muted-foreground" dateTime={occurredAt(item)}>
                      {formatDate(occurredAt(item), item.itemKind !== "deadline")}
                    </time>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      <Button
        variant="outline"
        size="lg"
        className="h-11 sm:h-9"
        disabled={cursor === null || load.isPending}
        onClick={() => mutate(cursor)}
      >
        {load.isPending ? t("loading") : t("loadMore")}
      </Button>
    </div>
  );
}
