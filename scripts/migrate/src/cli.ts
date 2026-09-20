import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const migrateDir = dirname(fileURLToPath(import.meta.url));
export const outDir = join(migrateDir, "..", "out");
export const repoRoot = resolve(migrateDir, "..", "..", "..");

export type Args = { flags: Map<string, string[]>; positional: string[] };

export function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    let value: string | undefined;
    if (equals !== -1) value = token.slice(equals + 1);
    else {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index += 1;
      }
    }
    const bucket = flags.get(name) ?? [];
    bucket.push(value ?? "");
    flags.set(name, bucket);
  }
  return { flags, positional };
}

export function flag(args: Args, name: string): string | undefined {
  const values = args.flags.get(name);
  return values?.[values.length - 1];
}

export function has(args: Args, name: string): boolean {
  return args.flags.has(name);
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value) throw new Error(`${name} manquant : renseignez-le dans .env`);
  return value;
}

export type Io = { out: (line: string) => void; err: (line: string) => void };

export const stdio: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

export const EXIT_OK = 0;
export const EXIT_BLOCKED = 1;
export const EXIT_UNREACHABLE = 2;
export const EXIT_USAGE = 3;
