import "server-only";
import { REQUEST_ID_HEADER, requestIdFromHeader } from "@lfsci/kernel";
import { auth } from "../auth";
import { type Db, db } from "../db";

type Session = Awaited<ReturnType<ReturnType<typeof auth>["api"]["getSession"]>>;

export type RpcContext = {
  requestId: string;
  session: Session;
  organizationId: string | null;
  /** The member's role in the active organization, read once per request; null without one. */
  role: string | null;
  db: Db;
  headers: Headers;
};

function activeOrganizationId(session: Session): string | null {
  const value = (session?.session as { activeOrganizationId?: string | null } | undefined)
    ?.activeOrganizationId;
  return value ?? null;
}

async function activeRole(headers: Headers, organizationId: string | null): Promise<string | null> {
  if (!organizationId) return null;
  const member = await auth().api.getActiveMember({ headers });
  return member?.role ?? null;
}

export async function createRpcContext(request: Request): Promise<RpcContext> {
  const requestId = requestIdFromHeader(request.headers.get(REQUEST_ID_HEADER));
  const session = await auth().api.getSession({ headers: request.headers });
  const organizationId = activeOrganizationId(session);
  return {
    requestId,
    session,
    organizationId,
    role: await activeRole(request.headers, organizationId),
    db: db(),
    headers: request.headers,
  };
}
