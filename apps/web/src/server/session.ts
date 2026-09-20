import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export type AppSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

export async function getSession() {
  const requestHeaders = await headers();
  return auth().api.getSession({ headers: requestHeaders });
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession();
  if (!session) redirect("/connexion");
  return session;
}

export async function listOrganizations() {
  const session = await getSession();
  if (!session) return [];
  const requestHeaders = await headers();
  return auth().api.listOrganizations({ headers: requestHeaders });
}

/** Role of the session user in the active organization, or null when none. */
export async function activeRole(): Promise<string | null> {
  try {
    const requestHeaders = await headers();
    const member = await auth().api.getActiveMember({ headers: requestHeaders });
    return member?.role ?? null;
  } catch {
    return null;
  }
}
