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
  /** `doc` is Odoo 19's /doc; `fields_get` is the 18 fallback, which cannot list methods. */
  source?: "doc" | "fields_get";
};

/** No Odoo RPC lists a model's methods, so the snapshot records the ones we call. */
export const CONNECTOR_METHODS: Record<string, string[]> = {
  "res.partner": ["search_read", "create", "write"],
  "res.company": ["search_read", "write"],
  "account.journal": ["search_read", "write"],
  "account.account": ["search_read"],
  "account.move": ["search_read", "create", "write", "action_post"],
  "account.move.line": ["search_read"],
  "account.bank.statement": ["search_read"],
  "account.bank.statement.line": [
    "search_read",
    "write",
    "add_multiple_lines",
    "reconcile_bank_line",
    "unreconcile_bank_line",
  ],
  "account.statement.import": ["create", "import_file_button"],
  "ir.attachment": ["search_read", "create"],
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

/**
 * Odoo 18 has no /doc, and `ir.model` is readable only by Access Rights users, so a
 * service account introspects each model with `fields_get` instead.
 */
export async function introspectCapabilitySnapshot(
  client: OdooClient,
  methodsByModel: Record<string, string[]> = CONNECTOR_METHODS,
): Promise<CapabilitySnapshot> {
  const models: Record<string, CapabilityModel> = {};
  const unreachable: Record<string, string> = {};

  for (const [model, methods] of Object.entries(methodsByModel)) {
    try {
      const described = await client.call<Record<string, unknown>>(
        model,
        "fields_get",
        { allfields: [], attributes: ["type", "store"] },
        { idempotent: true },
      );
      models[model] = { methods, fields: Object.keys(described).sort() };
    } catch (cause) {
      unreachable[model] = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const parsed = { models, unreachable };
  return {
    capturedAt: new Date().toISOString(),
    baseUrl: client.baseUrl,
    database: client.database,
    raw: JSON.stringify(parsed),
    parsed,
    models,
    source: "fields_get",
  };
}

export async function fetchCapabilitySnapshot(
  client: OdooClient,
  methodsByModel: Record<string, string[]> = CONNECTOR_METHODS,
): Promise<CapabilitySnapshot> {
  if (client.transport === "jsonrpc") return introspectCapabilitySnapshot(client, methodsByModel);
  const doc = await client.getDoc();
  return {
    capturedAt: new Date().toISOString(),
    baseUrl: client.baseUrl,
    database: client.database,
    raw: doc.text,
    parsed: doc.json,
    models: parseCapabilityModels(doc.json),
    source: "doc",
  };
}

export function hasCapabilityField(
  snapshot: CapabilitySnapshot | null | undefined,
  model: string,
  field: string,
): boolean {
  const fields = snapshot?.models?.[model]?.fields;
  return fields === undefined ? true : fields.includes(field);
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
