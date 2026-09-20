import { AppError } from "@lfsci/kernel";
import type { OdooClient } from "./client";
import { isRecord } from "./errors";

export type CapabilityModel = {
  methods: string[];
  fields?: string[];
};

export type CapabilitySnapshot = {
  capturedAt: string;
  baseUrl: string;
  database: string | undefined;
  raw: string;
  parsed: unknown;
  models: Record<string, CapabilityModel> | undefined;
};

function readMethods(entry: unknown): string[] | undefined {
  if (Array.isArray(entry)) return entry.filter((m): m is string => typeof m === "string");
  if (isRecord(entry)) {
    if (Array.isArray(entry.methods)) {
      return entry.methods.filter((m): m is string => typeof m === "string");
    }
    return Object.keys(entry);
  }
  return undefined;
}

export function parseCapabilityModels(
  parsed: unknown,
): Record<string, CapabilityModel> | undefined {
  if (!isRecord(parsed)) return undefined;
  const source = isRecord(parsed.models) ? parsed.models : parsed;
  const models: Record<string, CapabilityModel> = {};
  for (const [model, entry] of Object.entries(source)) {
    const methods = readMethods(entry);
    if (!methods) continue;
    const fields =
      isRecord(entry) && Array.isArray(entry.fields)
        ? entry.fields.filter((f): f is string => typeof f === "string")
        : undefined;
    models[model] = fields ? { methods, fields } : { methods };
  }
  return Object.keys(models).length > 0 ? models : undefined;
}

export async function fetchCapabilitySnapshot(client: OdooClient): Promise<CapabilitySnapshot> {
  const doc = await client.getDoc();
  return {
    capturedAt: new Date().toISOString(),
    baseUrl: client.baseUrl,
    database: client.database,
    raw: doc.text,
    parsed: doc.json,
    models: parseCapabilityModels(doc.json),
  };
}

export function assertCapability(
  snapshot: CapabilitySnapshot | null | undefined,
  model: string,
  method: string,
): void {
  if (!snapshot?.models) return;
  const entry = snapshot.models[model];
  if (!entry) {
    throw new AppError("RULE_VIOLATION", {
      message: `le modèle Odoo ${model} est absent de l'instantané de capacités`,
      details: { model, method, capturedAt: snapshot.capturedAt },
    });
  }
  if (!entry.methods.includes(method)) {
    throw new AppError("RULE_VIOLATION", {
      message: `la méthode Odoo ${model}.${method} est absente de l'instantané de capacités`,
      details: { model, method, capturedAt: snapshot.capturedAt },
    });
  }
}
