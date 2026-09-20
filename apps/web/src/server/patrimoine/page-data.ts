import "server-only";
import type { Tx } from "@lfsci/db";
import { isAppError, REQUEST_ID_HEADER, requestIdFromHeader } from "@lfsci/kernel";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { tenant } from "../data";
import { requireSession } from "../session";

/** Server-component read in the session's tenant transaction, same RLS as oRPC. */
export async function readScoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const session = await requireSession();
  const organizationId =
    (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  if (!organizationId) notFound();
  const requestId = requestIdFromHeader((await headers()).get(REQUEST_ID_HEADER));
  return tenant({ requestId, session, organizationId }, fn);
}

/** An unknown id and a foreign one both render the 404 page (tech pack §10). */
export async function readOrNotFound<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await readScoped(fn);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
