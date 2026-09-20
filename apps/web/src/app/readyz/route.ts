import { databaseStatus } from "@/server/rpc/modules/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const database = await databaseStatus();
  const ready = database === "up";
  return Response.json(
    {
      status: ready ? "ready" : "degraded",
      // storage and queue land with the integrations and the worker.
      components: { database, storage: "unknown", queue: "unknown" },
    },
    { status: ready ? 200 : 503 },
  );
}
