export const redactKeys = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "accessKey",
  "iban",
  "datas",
];

const ibanPattern = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{1,4}\b/g;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth]";
  if (typeof value === "string") return value.replace(ibanPattern, "[iban]");
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] =
        redactKeys.includes(k.toLowerCase()) || redactKeys.includes(k)
          ? "[redacted]"
          : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}
