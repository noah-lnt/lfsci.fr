import type { ErrorEvent } from "@sentry/nextjs";

export const sentryDsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

export const sharedOptions = {
  tracesSampleRate: 0.1,
  sendDefaultPii: false as const,
};

/** Drops what the SDK collects about the person before anything is queued. */
export function stripIdentity(event: ErrorEvent): ErrorEvent {
  delete event.user;
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
  }
  return event;
}
