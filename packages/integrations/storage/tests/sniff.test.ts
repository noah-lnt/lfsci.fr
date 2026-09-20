import { describe, expect, it } from "vitest";
import { sniffContentType } from "../src/sniff";

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") out.push(...Array.from(part, (c) => c.charCodeAt(0)));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}

describe("sniffContentType", () => {
  it("recognises pdf, png, jpeg, webp and heic", () => {
    expect(sniffContentType(bytes("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffContentType(bytes([0x89], "PNG\r\n", [0x1a, 0x0a]))).toBe("image/png");
    expect(sniffContentType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffContentType(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("image/heic");
  });

  it("separates an xlsx from a plain zip", () => {
    expect(sniffContentType(bytes([0x50, 0x4b, 0x03, 0x04], "xl/workbook.xml"))).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(sniffContentType(bytes([0x50, 0x4b, 0x03, 0x04], "docProps/app.xml"))).toBe(
      "application/zip",
    );
  });

  it("separates csv from plain text and rejects binary noise", () => {
    expect(sniffContentType(bytes("date;libelle;montant\n2026-01-01;loyer;850.00\n"))).toBe(
      "text/csv",
    );
    expect(sniffContentType(bytes("note libre sans separateur\n"))).toBe("text/plain");
    expect(sniffContentType(bytes([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
  });
});
