import "server-only";
import { createDb, type DbHandle, type Tx, withTenant } from "@lfsci/db";
import { env } from "./env";
import type { RpcContext } from "./rpc/context";

let handle: DbHandle | undefined;

export function appDb(): DbHandle {
  if (!handle) {
    handle = createDb({ url: env().DATABASE_URL, max: 10, applicationName: "lfsci-web" });
  }
  return handle;
}

type TenantScope = Pick<RpcContext, "requestId" | "session"> & { organizationId: string };

/** Runs fn in the session's tenant transaction (RLS + app role), correlated by request id. */
export function tenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(
    appDb(),
    {
      organizationId: scope.organizationId,
      requestId: scope.requestId,
      ...(scope.session ? { actorId: scope.session.user.id } : {}),
    },
    fn,
  );
}
