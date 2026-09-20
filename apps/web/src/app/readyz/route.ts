import { databaseStatus, modelStatus } from "@/server/rpc/modules/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const database = await databaseStatus();
  // The model is reported, never gating: the app is usable without it.
  const model = await modelStatus();
  const ready = database === "up";
  return Response.json(
    {
      status: ready ? "ready" : "degraded",
      // storage and queue land with the integrations and the worker.
      components: { database, storage: "unknown", queue: "unknown", model },
    },
    { status: ready ? 200 : 503 },
  );
}
