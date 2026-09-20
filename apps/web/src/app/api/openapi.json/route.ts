import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { router } from "@/server/rpc/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
});

export async function GET(): Promise<Response> {
  const document = await generator.generate(router, {
    info: { title: "lfsci.fr API", version: "0.1.0" },
    servers: [{ url: "/api/rpc" }],
  });
  return Response.json(document);
}
