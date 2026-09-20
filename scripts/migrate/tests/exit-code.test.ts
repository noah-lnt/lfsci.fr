import { spawn } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateDir, repoRoot } from "../src/cli";
import { fixture } from "./helpers";

function runScript(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        join(migrateDir, "..", "dry-run.ts"),
        ...args,
      ],
      { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("dry-run entry point", () => {
  it("exits non-zero and names the sources it could not reach, instead of reporting nothing found", async () => {
    const result = await runScript(
      [
        "--organization",
        "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        "--odoo",
        "--tenants",
        fixture("tenants.csv"),
      ],
      {
        ODOO_BASE_URL: "http://127.0.0.1:9",
        ODOO_API_KEY: "x",
        ODOO_DATABASE: "x",
        ODOO_LOGIN: "x",
        ODOO_TRANSPORT: "jsonrpc",
        ODOO_MIGRATE_TIMEOUT_MS: "1000",
        DATABASE_URL: "postgres://x:x@127.0.0.1:9/x",
      },
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("une source n’a pas pu être lue");
    expect(result.stderr).toContain("odoo : Odoo res.partner");
    expect(result.stderr).toContain("database : Base de l’application injoignable");
    expect(result.stdout).not.toContain("Import à blanc —");
  }, 30_000);

  it("refuses to run without an organization", async () => {
    const result = await runScript(["--odoo"], { DATABASE_URL: "postgres://x:x@127.0.0.1:9/x" });
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("--organization");
  }, 30_000);
});
