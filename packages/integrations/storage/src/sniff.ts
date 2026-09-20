export const SNIFFABLE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/csv",
  "text/plain",
] as const;
export type SniffedType = (typeof SNIFFABLE_TYPES)[number];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return Array.from(bytes.slice(start, start + length), (b) => String.fromCharCode(b)).join("");
}

// ISO-BMFF brands that identify HEIF/HEIC stills (ISO/IEC 23008-12).
const heicBrands = new Set(["heic", "heix", "hevc", "hevx", "mif1", "msf1"]);

function isZipSpreadsheet(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, Math.min(bytes.length, 4096)).includes("xl/");
}

function looksTextual(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 2048);
  if (sample.length === 0) return false;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

export function sniffContentType(bytes: Uint8Array): SniffedType | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (ascii(bytes, 4, 4) === "ftyp" && heicBrands.has(ascii(bytes, 8, 4))) return "image/heic";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return isZipSpreadsheet(bytes)
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/zip";
  }
  if (!looksTextual(bytes)) return undefined;
  const firstLine = new TextDecoder().decode(bytes.slice(0, 2048)).split(/\r?\n/)[0] ?? "";
  return /[;,\t]/.test(firstLine) ? "text/csv" : "text/plain";
}
