"use client";

import type { api, ErrorPayload } from "@lfsci/contracts";
import { Send } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { ErrorBox } from "@/components/feedback/error-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REQUEST_ID_HEADER } from "@/lib/rpc";

type Turn = { id: string; role: "user" | "assistant"; content: string };
type WireEvent = api.assistant.AssistantEvent;

const TOOL_NAMES = [
  "get_action_required",
  "summarize_object",
  "search_memory",
  "explain_amount",
  "propose_command",
] as const;

/** A `data:` frame can arrive split across chunks; parse only on a complete frame. */
function drainFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

export function AssistantPanel() {
  const t = useTranslations("assistant");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState("");
  const [tools, setTools] = useState<{ id: string; name: string }[]>([]);
  const [proposal, setProposal] = useState<string | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  async function send(): Promise<void> {
    const text = message.trim();
    if (!text || busy) return;

    const history = turns;
    setTurns([...history, { id: uuidv7(), role: "user", content: text }]);
    setMessage("");
    setStreaming("");
    setTools([]);
    setProposal(null);
    setError(null);
    setBusy(true);

    let answer = "";
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", [REQUEST_ID_HEADER]: uuidv7() },
        body: JSON.stringify({ message: text, history }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("no stream");
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = drainFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          const payload = frame.replace(/^data: ?/, "").trim();
          if (!payload) continue;
          let event: WireEvent;
          try {
            event = JSON.parse(payload) as WireEvent;
          } catch {
            continue;
          }
          if (event.type === "text_delta") {
            answer += event.text;
            setStreaming(answer);
          } else if (event.type === "tool_call") {
            const name = event.name;
            if ((TOOL_NAMES as readonly string[]).includes(name)) {
              setTools((current) => [...current, { id: event.toolCallId, name }]);
            }
          } else if (event.type === "tool_result" && event.proposedCommandId) {
            setProposal(event.proposedCommandId);
          } else if (event.type === "error") {
            setError(event.error);
          }
        }
      }
    } catch {
      setError({
        code: "UPSTREAM_UNAVAILABLE",
        message: "L’assistant est injoignable.",
        requestId: "—",
      });
    } finally {
      if (answer) {
        setTurns((current) => [...current, { id: uuidv7(), role: "assistant", content: answer }]);
      }
      setStreaming("");
      setBusy(false);
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t("conversation")}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm"
      >
        {turns.length === 0 && !streaming ? (
          <p className="text-muted-foreground">{t("emptyState")}</p>
        ) : null}

        {turns.map((turn) => (
          <p key={turn.id} className={turn.role === "user" ? "font-medium" : "whitespace-pre-wrap"}>
            {turn.role === "user" ? `${t("you")} : ` : ""}
            {turn.content}
          </p>
        ))}

        {streaming ? <p className="whitespace-pre-wrap">{streaming}</p> : null}

        {tools.length > 0 ? (
          <p className="flex flex-wrap gap-1">
            {tools.map((tool) => (
              <Badge key={tool.id} variant="secondary">
                {t(`tool.${tool.name}`)}
              </Badge>
            ))}
          </p>
        ) : null}

        {proposal ? (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-medium">{t("proposal")}</p>
            <p className="mt-1 text-muted-foreground">{t("proposalHint")}</p>
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              render={<Link href={`/validations#${proposal}`} />}
            >
              {t("openProposal")}
            </Button>
          </div>
        ) : null}

        {error ? <ErrorBox error={error} /> : null}
      </div>

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Label htmlFor="assistant-message">{t("title")}</Label>
        <Textarea
          id="assistant-message"
          name="message"
          rows={3}
          placeholder={t("placeholder")}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button type="submit" disabled={busy || message.trim().length === 0} className="w-full">
          <Send aria-hidden="true" />
          {busy ? t("sending") : t("send")}
        </Button>
      </form>
    </div>
  );
}
