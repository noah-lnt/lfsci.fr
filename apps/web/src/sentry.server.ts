import "server-only";
import { redactValue } from "@lfsci/kernel";
import type { ErrorEvent } from "@sentry/nextjs";
import { stripIdentity } from "./sentry.shared";

/** Server side adds the shared redactor (tech pack §10.1/§11.3). */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  const stripped = stripIdentity(event);
  if (stripped.extra) {
    stripped.extra = redactValue(stripped.extra) as typeof stripped.extra;
  }
  if (stripped.request) {
    stripped.request = redactValue(stripped.request) as typeof stripped.request;
  }
  return stripped;
}
