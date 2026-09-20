import "server-only";
import type { ComponentStatus } from "@/lib/contract";
import { ReadyResult } from "@/lib/contract";
import { sql } from "../../db";
import { pub, validated } from "../base";

export async function databaseStatus(): Promise<ComponentStatus> {
  try {
    await sql()`SELECT 1`;
    return "up";
  } catch {
    return "down";
  }
}

export const health = {
  ready: pub.health.ready.use(validated(ReadyResult)).handler(async ({ context }) => {
    const database = await databaseStatus();
    return {
      status: database === "up" ? ("ready" as const) : ("degraded" as const),
      requestId: context.requestId,
      // storage and queue arrive with the integrations and the worker.
      components: { database, storage: "unknown" as const, queue: "unknown" as const },
    };
  }),
};
