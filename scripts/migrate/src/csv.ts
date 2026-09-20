/** Same reader as apps/web/src/server/courte-duree/csv.ts, without the server-only guard. */
export type CsvRecord = { line: number; cells: string[] };

export type CsvTable = {
  delimiter: string;
  headers: string[];
  records: CsvRecord[];
};

export class CsvError extends Error {}

const CANDIDATES = [",", ";", "\t", "|"] as const;

function tokenize(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let started = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(field);
    if (started || cells.length > 1) records.push({ line: recordLine, cells });
    cells = [];
    field = "";
    started = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      if (char === "\n") line += 1;
      field += char;
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
      started = true;
      continue;
    }
    if (char === delimiter) {
      cells.push(field);
      field = "";
      started = true;
      continue;
    }
    if (char === "\r") continue;
    if (char === "\n") {
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    if (char !== undefined) {
      field += char;
      started = true;
    }
  }
  if (started || field !== "" || cells.length > 0) endRecord();
  return records;
}

function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    const count = tokenize(firstLine, candidate)[0]?.cells.length ?? 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, options?: { delimiter?: string }): CsvTable {
  const clean = text.replace(/^﻿/, "");
  if (clean.trim() === "") throw new CsvError("Le fichier est vide.");
  const delimiter = options?.delimiter ?? sniffDelimiter(clean);
  const records = tokenize(clean, delimiter);
  const header = records[0];
  if (!header) throw new CsvError("Le fichier ne contient aucune ligne.");
  const headers = header.cells.map((cell) => cell.trim());
  if (headers.every((cell) => cell === "")) {
    throw new CsvError("La première ligne ne porte aucun nom de colonne.");
  }
  return { delimiter, headers, records: records.slice(1) };
}

export function normaliseHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function cellsByHeader(table: CsvTable, record: CsvRecord): Map<string, string> {
  const byName = new Map<string, string>();
  table.headers.forEach((header, index) => {
    const key = normaliseHeader(header);
    if (key === "" || byName.has(key)) return;
    byName.set(key, (record.cells[index] ?? "").trim());
  });
  return byName;
}
