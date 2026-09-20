import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@lfsci/kernel";
import { SVIX_TOLERANCE_SECONDS } from "./config";

export type WebhookHeaders = Record<string, string | string[] | undefined>;

function header(headers: WebhookHeaders, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

function secretKey(secret: string): Buffer {
  const encoded = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(encoded, "base64");
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyResendWebhook(input: {
  headers: WebhookHeaders;
  rawBody: string;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): { id: string; timestamp: number; payload: unknown } {
  const id = header(input.headers, "svix-id");
  const timestamp = header(input.headers, "svix-timestamp");
  const signature = header(input.headers, "svix-signature");
  if (!id || !timestamp || !signature) {
    throw new AppError("UNAUTHENTICATED", { message: "missing svix signature headers" });
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    throw new AppError("UNAUTHENTICATED", { message: "invalid svix-timestamp" });
  }
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - sentAt) > tolerance) {
    throw new AppError("UNAUTHENTICATED", {
      message: "svix timestamp outside the tolerance window",
      details: { toleranceSeconds: tolerance },
    });
  }

  const expected = createHmac("sha256", secretKey(input.secret))
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest("base64");

  // Svix lists one or more signatures space-separated, each as `<version>,<base64>`.
  const matched = signature
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => equals(part.slice(3), expected));
  if (!matched) {
    throw new AppError("UNAUTHENTICATED", { message: "svix signature mismatch" });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch (cause) {
    throw new AppError("VALIDATION", { message: "webhook body is not json", cause });
  }
  return { id, timestamp: sentAt, payload };
}

export function signResendWebhook(input: {
  id: string;
  timestamp: number;
  rawBody: string;
  secret: string;
}): string {
  const digest = createHmac("sha256", secretKey(input.secret))
    .update(`${input.id}.${input.timestamp}.${input.rawBody}`)
    .digest("base64");
  return `v1,${digest}`;
}
