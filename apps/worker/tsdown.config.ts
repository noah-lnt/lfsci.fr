import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts", "src/migrate.ts"],
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  dts: false,
  sourcemap: true,
  // The image runs `node dist/main.js` and `node dist/migrate.js`; package.json
  // declares "type": "module", so a plain .js is already ESM.
  outExtensions: () => ({ js: ".js" }),
  deps: {
    // A native binary and the modules that own a connection or a transport
    // stay in node_modules, which the image copies.
    neverBundle: ["sharp", "pg-boss", "postgres", "pino", "pino-pretty", "@sentry/node"],
    // The workspace packages ship raw TypeScript, which Node cannot import, so
    // they and their own dependencies are compiled into the bundle.
    alwaysBundle: [/^@lfsci\//],
  },
});
