import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The worker suite truncates every table, so it gets a database of its own: the db
// project truncates the same tables at the same time otherwise.
const workerDatabaseUrl = (() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_worker`;
  return parsed.toString();
})();

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/**/tests/**/*.test.ts"],
          exclude: ["packages/db/tests/db/**", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "db",
          include: ["packages/db/tests/db/**/*.test.ts"],
          environment: "node",
          setupFiles: ["packages/db/tests/db/setup.ts"],
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "worker",
          setupFiles: ["tests/setup/worker-db.ts"],
          ...(workerDatabaseUrl ? { env: { TEST_DATABASE_URL: workerDatabaseUrl } } : {}),
          include: ["apps/worker/tests/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
        },
      },
      {
        // Opt-in (docs/ai-eval.md): the suite skips itself unless AI_EVAL=1 and a
        // corpus is present, so `npm run check` never calls a model.
        test: {
          name: "ai-eval",
          include: ["packages/ai/eval/**/*.eval.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 600_000,
        },
      },
      {
        resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
        test: {
          name: "web",
          include: ["apps/web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
