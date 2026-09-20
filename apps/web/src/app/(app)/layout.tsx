// Session-bearing: never prerendered.
export const dynamic = "force-dynamic";

import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AppShell } from "@/components/layout/app-shell";
import { activeRole, requireSession } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const role = await activeRole();

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      organizationId={
        (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null
      }
      showAdmin={role === "owner_admin"}
      assistant={<AssistantPanel />}
    >
      {children}
    </AppShell>
  );
}
