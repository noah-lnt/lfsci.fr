import { REQUEST_ID_HEADER } from "@lfsci/kernel";
import { RPCHandler } from "@orpc/server/fetch";
import { createRpcContext } from "@/server/rpc/context";
import { router } from "@/server/rpc/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = new RPCHandler(router);

async function handle(request: Request): Promise<Response> {
  const context = await createRpcContext(request);
  const { matched, response } = await handler.handle(request, { prefix: "/api/rpc", context });
  const result = matched && response ? response : new Response("Not found", { status: 404 });
  result.headers.set(REQUEST_ID_HEADER, context.requestId);
  return result;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
