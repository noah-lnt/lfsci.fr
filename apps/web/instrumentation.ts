import * as Sentry from "@sentry/nextjs";
import { sentryDsn, sharedOptions } from "./src/sentry.shared";

export async function register(): Promise<void> {
  if (!sentryDsn) return;
  const { beforeSend } = await import("./src/sentry.server");
  Sentry.init({ dsn: sentryDsn, ...sharedOptions, beforeSend });
}

export const onRequestError = Sentry.captureRequestError;
