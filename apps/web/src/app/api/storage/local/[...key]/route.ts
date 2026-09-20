import { MAX_UPLOAD_BYTES } from "@lfsci/storage";
import { isDevOrTest } from "@/server/env";
import { localStorageDriver } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ key: string[] }> };

function refused(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/** Development stand-in for the object store; never mounted in production. */
async function target(request: Request, params: Params["params"], method: "PUT" | "GET") {
  if (!isDevOrTest()) return { error: refused(404, "not found") } as const;
  const store = localStorageDriver();
  if (!store) return { error: refused(404, "not found") } as const;

  const key = (await params).key.join("/");
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!store.verifyToken({ method, key, token })) {
    return { error: refused(403, "invalid or expired token") } as const;
  }
  return { store, key } as const;
}

export async function PUT(request: Request, { params }: Params): Promise<Response> {
  const resolved = await target(request, params, "PUT");
  if ("error" in resolved) return resolved.error;

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_UPLOAD_BYTES) return refused(413, "payload too large");

  await resolved.store.putObject({
    key: resolved.key,
    body,
    contentType: request.headers.get("content-type") ?? "application/octet-stream",
  });
  return new Response(null, { status: 200, headers: { etag: `"${body.byteLength}"` } });
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const resolved = await target(request, params, "GET");
  if ("error" in resolved) return resolved.error;

  const filename = new URL(request.url).searchParams.get("filename");
  try {
    const object = await resolved.store.getObject(resolved.key);
    return new Response(object.body as BodyInit, {
      status: 200,
      headers: {
        "content-type": object.contentType,
        "content-length": String(object.body.byteLength),
        ...(filename ? { "content-disposition": `attachment; filename="${filename}"` } : {}),
      },
    });
  } catch {
    return refused(404, "not found");
  }
}
