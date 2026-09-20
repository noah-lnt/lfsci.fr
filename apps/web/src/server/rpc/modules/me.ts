import "server-only";
import { MeResult } from "@/lib/contract";
import { auth } from "../../auth";
import { authed, validated } from "../base";

export const me = {
  get: authed.me.get.use(validated(MeResult)).handler(async ({ context }) => {
    const memberships = await auth().api.listOrganizations({ headers: context.headers });
    return {
      user: {
        id: context.session.user.id,
        email: context.session.user.email,
        name: context.session.user.name,
        twoFactorEnabled:
          (context.session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled ?? false,
      },
      activeOrganizationId: context.organizationId,
      organizations: memberships.map((organization) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: (organization as { role?: string | null }).role ?? null,
      })),
    };
  }),
};
