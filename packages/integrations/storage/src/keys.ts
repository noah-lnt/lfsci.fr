import { AppError } from "@lfsci/kernel";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function safeFilename(input: string): string {
  const base = input.split("/").pop()?.split("\\").pop() ?? "";
  const cleaned = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 120);
  if (cleaned.length === 0) throw new AppError("VALIDATION", { message: "filename is empty" });
  return cleaned;
}

export function documentKey(input: {
  organizationId: string;
  documentId: string;
  version: number;
  filename: string;
}): string {
  if (!uuidPattern.test(input.organizationId) || !uuidPattern.test(input.documentId)) {
    throw new AppError("VALIDATION", { message: "organizationId and documentId must be uuids" });
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new AppError("VALIDATION", { message: "version must be a positive integer" });
  }
  return `org/${input.organizationId}/doc/${input.documentId}/v${input.version}/${safeFilename(input.filename)}`;
}
