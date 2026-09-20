import { Fragment } from "react";

/** `ts_headline` is asked for `[[`/`]]` around the matched words (server/recherche/query.ts). */
const MARKER = /\[\[(.*?)\]\]/gs;

export function Highlight({ text }: { text: string }) {
  const parts: { key: string; value: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKER)) {
    const start = match.index;
    if (start > cursor) {
      parts.push({ key: `p${cursor}`, value: text.slice(cursor, start), marked: false });
    }
    parts.push({ key: `m${start}`, value: match[1] ?? "", marked: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ key: `p${cursor}`, value: text.slice(cursor), marked: false });
  }

  return (
    <>
      {parts.map((part) =>
        part.marked ? (
          <mark key={part.key} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
            {part.value}
          </mark>
        ) : (
          <Fragment key={part.key}>{part.value}</Fragment>
        ),
      )}
    </>
  );
}
