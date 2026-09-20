import "server-only";
import { REQUEST_ID_HEADER, requestIdFromHeader } from "@lfsci/kernel";
import { auth } from "../auth";
import { type Db, db } from "../db";

type Session = Awaited<ReturnType<ReturnType<typeof auth>["api"]["getSession"]>>;

export type RpcContext = {
  requestId: string;
  session: Session;
  organizationId: string | null;
  db: Db;
  headers: Headers;
};

function activeOrganizationId(session: Session): string | null {
  const value = (session?.session as { activeOrganizationId?: string | null } | undefined)
    ?.activeOrganizationId;
  return value ?? null;
}

export async function createRpcContext(request: Request): Promise<RpcContext> {
  const requestId = requestIdFromHeader(request.headers.get(REQUEST_ID_HEADER));
  const session = await auth().api.getSession({ headers: request.headers });
  return {
    requestId,
    session,
    organizationId: activeOrganizationId(session),
    db: db(),
    headers: request.headers,
  };
}
