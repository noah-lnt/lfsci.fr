import type { ErrorPayload } from "@lfsci/contracts";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { v7 as uuidv7 } from "uuid";
import type { AppContract } from "@/lib/contract";

export const REQUEST_ID_HEADER = "x-request-id";

function baseUrl(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/rpc`;
}

const link = new RPCLink({
  url: baseUrl,
  headers: () => ({ [REQUEST_ID_HEADER]: uuidv7() }),
});

export const rpc: ContractRouterClient<AppContract> = createORPCClient(link);

type ErrorLike = { data?: unknown; message?: unknown };

/** Pulls the typed `{ code, message, requestId }` out of whatever was thrown. */
export function errorPayload(error: unknown): ErrorPayload {
  const candidate = (error as ErrorLike | undefined)?.data;
  if (
    candidate &&
    typeof candidate === "object" &&
    "code" in candidate &&
    "requestId" in candidate
  ) {
    return candidate as ErrorPayload;
  }
  const message = (error as ErrorLike | undefined)?.message;
  return {
    code: "INTERNAL",
    message: typeof message === "string" ? message : "Erreur inattendue.",
    requestId: "—",
  };
}
