import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: [
    "@lfsci/ai",
    "@lfsci/contracts",
    "@lfsci/db",
    "@lfsci/domain",
    "@lfsci/kernel",
    "@lfsci/storage",
  ],
  serverExternalPackages: ["pino", "pino-pretty", "postgres", "sharp"],
  images: { remotePatterns: [] },
};

export default withNextIntl(nextConfig);
