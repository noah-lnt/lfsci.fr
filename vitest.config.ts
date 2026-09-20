import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
          include: ["apps/worker/tests/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
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
