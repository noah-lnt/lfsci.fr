import { REQUEST_ID_HEADER, requestIdFromHeader } from "@lfsci/kernel";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
import { rateLimit, tooManyRequests } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Built per request: `auth()` reads the environment, which does not exist at build time.
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(auth()).GET(request);
}

// GET is left unthrottled: every authenticated page reads the session through it.
export async function POST(request: Request): Promise<Response> {
  const throttle = rateLimit("auth", request);
  if (!throttle.allowed) {
    return tooManyRequests(throttle, requestIdFromHeader(request.headers.get(REQUEST_ID_HEADER)));
  }
  return toNextJsHandler(auth()).POST(request);
}
