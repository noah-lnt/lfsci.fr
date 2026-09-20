import "server-only";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

/** An unset key and a key present but empty mean the same thing in a .env file. */
const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

const shape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: requiredString,
  BETTER_AUTH_SECRET: requiredString,
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  ENCRYPTION_KEY: optional,
  SENTRY_DSN: optional,
};

export type Env = z.infer<z.ZodObject<typeof shape>>;

let cached: Env | undefined;

function loadRepoEnvFile(): void {
  if (process.env.NODE_ENV === "production") return;
  for (const candidate of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function env(): Env {
  if (!cached) {
    loadRepoEnvFile();
    cached = parseEnv(shape);
  }
  return cached;
}

export function isDevOrTest(): boolean {
  return process.env.NODE_ENV !== "production";
}
