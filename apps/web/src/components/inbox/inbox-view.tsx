"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { DateValue } from "@/components/ui/date";
import { Skeleton } from "@/components/ui/skeleton";
import { errorPayload, rpc } from "@/lib/rpc";
import { CaptureForm } from "./capture-form";
import { InboxDetail } from "./inbox-detail";
import { RuleProposals } from "./rule-proposals";

export function InboxView() {
  const t = useTranslations("inbox");
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const list = useQuery({
    queryKey: ["inbox", "list"],
    queryFn: () => rpc.inbox.list({ openOnly: true, limit: 50 }),
  });

  const items = list.data?.items ?? [];

  /** Up and down move the focus inside the triage list without leaving the keyboard. */
  function move(index: number, delta: number): void {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-inbox-item]");
    buttons?.[index + delta]?.focus();
  }

  return (
    <div className="space-y-4">
      <CaptureForm />

      <RuleProposals />

      {list.error ? <ErrorBox error={errorPayload(list.error)} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-label={t("listTitle")}>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            {t("listTitle")} · {t("openCount", { count: list.data?.openCount ?? 0 })}
          </h2>

          {list.isPending ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : items.length === 0 ? (
            <div
              className="rounded-xl border border-dashed bg-card p-8 text-center"
              data-testid="inbox-empty"
            >
              <h3 className="text-sm font-medium">{t("empty")}</h3>
              <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
                {t("emptyHint")}
              </p>
            </div>
          ) : (
            <ul ref={listRef} className="space-y-2">
              {items.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-inbox-item
                    data-testid="inbox-item"
                    aria-current={selected === item.id}
                    onClick={() => setSelected(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        move(index, 1);
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        move(index, -1);
                      }
                    }}
                    className={`w-full rounded-xl border p-3 text-left text-sm ${
                      selected === item.id ? "border-primary bg-primary/5" : "bg-card"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{t(`status.${item.status}`)}</Badge>
                      <span className="text-xs text-muted-foreground">{item.channel ?? "—"}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        <DateValue value={item.receivedAt} withTime />
                      </span>
                    </span>
                    <span className="mt-1 block truncate">{item.summary ?? "—"}</span>
                    {item.uncertaintyReason ? (
                      <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                        {t("uncertainty")} : {item.uncertaintyReason}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <InboxDetail
          id={selected}
          onDecided={(href) => {
            setSelected(null);
            if (href) router.push(href);
          }}
        />
      </div>
    </div>
  );
}
