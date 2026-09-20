import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { validate as isUuid, v7 as uuidv7 } from "uuid";

const REQUEST_ID_HEADER = "x-request-id";

export type PolicyContext = { isDev: boolean; servedOverTls: boolean };

/** The app's own URL decides, never the environment name: a CI or LAN deployment on plain http must not upgrade. */
export function servedOverTls(env: Record<string, string | undefined> = process.env): boolean {
  return (env.APP_URL ?? env.BETTER_AUTH_URL ?? "").startsWith("https://");
}

export function contentSecurityPolicy(nonce: string, context: PolicyContext): string {
  const { isDev, servedOverTls: tls } = context;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and next/font inject style elements without a nonce in dev.
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Chrome exempts localhost from the upgrade; WebKit does not, and every
    // script then fails TLS. Only a site that really answers on https may ask.
    ...(tls ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = incoming && isUuid(incoming) ? incoming : uuidv7();
  const nonce = btoa(uuidv7());
  const isDev = process.env.NODE_ENV === "development";
  const tls = servedOverTls();
  const csp = contentSecurityPolicy(nonce, { isDev, servedOverTls: tls });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  if (tls) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
