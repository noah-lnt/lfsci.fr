import { AppError } from "@lfsci/kernel";

export const OVERLAP_MS = 10 * 60 * 1000;

export type OdooCursor = {
  writeDate: string;
  id: number;
};

const odooDateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function encodeCursor(cursor: OdooCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): OdooCursor {
  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch (cause) {
    throw new AppError("VALIDATION", { message: "curseur Odoo illisible", cause });
  }
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("writeDate" in candidate) ||
    !("id" in candidate)
  ) {
    throw new AppError("VALIDATION", { message: "curseur Odoo incomplet" });
  }
  const { writeDate, id } = candidate as { writeDate: unknown; id: unknown };
  if (typeof writeDate !== "string" || !odooDateTime.test(writeDate)) {
    throw new AppError("VALIDATION", { message: "curseur Odoo : date invalide" });
  }
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new AppError("VALIDATION", { message: "curseur Odoo : identifiant invalide" });
  }
  return { writeDate, id };
}

export function toOdooDateTime(value: Date): string {
  return value.toISOString().slice(0, 19).replace("T", " ");
}

export function parseOdooDateTime(value: string): Date {
  if (!odooDateTime.test(value)) {
    throw new AppError("UPSTREAM_REJECTED", {
      message: "date Odoo au format inattendu",
      details: { value },
    });
  }
  return new Date(`${value.replace(" ", "T")}Z`);
}

export function overlapFrom(writeDate: string, overlapMs: number = OVERLAP_MS): string {
  return toOdooDateTime(new Date(parseOdooDateTime(writeDate).getTime() - overlapMs));
}

export function isAfterCursor(row: OdooCursor, cursor: OdooCursor | undefined): boolean {
  if (!cursor) return true;
  if (row.writeDate !== cursor.writeDate) return row.writeDate > cursor.writeDate;
  return row.id > cursor.id;
}
