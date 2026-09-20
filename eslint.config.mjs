import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

const serverOnlyMessage =
  "Server modules are imported by server code only; expose data through oRPC procedures.";
const odooMessage = "Only @lfsci/odoo may talk to Odoo; call its typed functions instead.";

export default [
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2023, sourceType: "module", ecmaFeatures: { jsx: true } },
    },
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "packages/db/src/generated/**",
      "apps/web/src/components/ui/**",
    ],
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ...jsxA11y.flatConfigs.strict,
    languageOptions: {
      ...jsxA11y.flatConfigs.strict.languageOptions,
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/server/**", "apps/web/src/app/api/**", "apps/web/src/app/**/route.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server", "@/server/*", "@/server/**"], message: serverOnlyMessage },
            { group: ["@lfsci/db", "@lfsci/db/*"], message: serverOnlyMessage },
            { group: ["@lfsci/odoo", "@lfsci/odoo/*"], message: odooMessage },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.ts"],
    ignores: ["packages/integrations/odoo/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@lfsci/odoo/src/*", "@lfsci/odoo/src/**"], message: odooMessage }],
        },
      ],
    },
  },
];
