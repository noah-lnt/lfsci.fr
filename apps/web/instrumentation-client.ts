import * as Sentry from "@sentry/nextjs";
import { sentryDsn, sharedOptions, stripIdentity } from "./src/sentry.shared";

if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, ...sharedOptions, beforeSend: stripIdentity });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
