import "server-only";
import { logger, newId } from "@lfsci/kernel";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization, twoFactor } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import * as authSchema from "./auth-schema";
import { db, sql } from "./db";
import { env } from "./env";

const log = logger("auth");

const ac = createAccessControl(defaultStatements);

/**
 * Organization roles are named with the application's own role vocabulary
 * (spec §3) so `auth_member.role` and `membership.role` never need a lookup.
 * Fine-grained decisions stay in packages/domain (tech pack §10).
 */
export const organizationRoles = {
  owner_admin: ac.newRole(ownerAc.statements),
  delegated_manager: ac.newRole(adminAc.statements),
  accountant: ac.newRole(memberAc.statements),
  partner_reader: ac.newRole(memberAc.statements),
};

export type OrganizationRole = keyof typeof organizationRoles;

const appRoleByOrganizationRole: Record<string, string> = {
  owner: "owner_admin",
  admin: "delegated_manager",
  member: "partner_reader",
  owner_admin: "owner_admin",
  delegated_manager: "delegated_manager",
  accountant: "accountant",
  partner_reader: "partner_reader",
};

function toAppRole(role: string): string {
  return appRoleByOrganizationRole[role.split(",")[0] ?? "member"] ?? "partner_reader";
}

function slugToCode(slug: string): string {
  return slug.trim().toUpperCase().slice(0, 32) || newId().slice(0, 8).toUpperCase();
}

async function mirrorUser(user: { id: string; email: string; name: string }): Promise<void> {
  await sql()`
    INSERT INTO app_user (id, email, full_name, status)
    VALUES (${user.id}::uuid, ${user.email}, ${user.name || user.email}, 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * better-auth adds the creator as a member DURING organization creation, so
 * `afterAddMember` fires before `afterCreateOrganization`: both paths write the
 * organization row first, in the same transaction as the membership.
 */
async function mirrorOrganizationAndMembership(input: {
  organization: { id: string; name: string; slug: string };
  userId: string;
  role?: string;
}): Promise<void> {
  const { organization: org, userId, role } = input;
  await sql().begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${org.id}, true)`;
    await tx`
      INSERT INTO organization (id, code, name)
      VALUES (${org.id}::uuid, ${slugToCode(org.slug)}, ${org.name})
      ON CONFLICT (id) DO NOTHING
    `;
    if (role === undefined) return;
    await tx`
      INSERT INTO membership (organization_id, app_user_id, role, status)
      VALUES (${org.id}::uuid, ${userId}::uuid, ${toAppRole(role)}, 'active')
      ON CONFLICT (organization_id, app_user_id, role) DO NOTHING
    `;
  });
}

function build() {
  const config = env();
  return betterAuth({
    appName: "lfsci",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db(), { provider: "pg", schema: authSchema }),
    advanced: {
      database: { generateId: () => newId() },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await mirrorUser({ id: user.id, email: user.email, name: user.name });
            log.info({ userId: user.id }, "app_user mirrored");
          },
        },
      },
    },
    plugins: [
      organization({
        ac,
        roles: organizationRoles,
        creatorRole: "owner_admin",
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org, member }) => {
            await mirrorOrganizationAndMembership({
              organization: { id: org.id, name: org.name, slug: org.slug },
              userId: member.userId,
              role: member.role,
            });
            log.info({ organizationId: org.id }, "organization mirrored");
          },
          afterAddMember: async ({ member, user, organization: org }) => {
            await mirrorUser({ id: user.id, email: user.email, name: user.name });
            await mirrorOrganizationAndMembership({
              organization: { id: org.id, name: org.name, slug: org.slug },
              userId: member.userId,
              role: member.role,
            });
          },
        },
      }),
      twoFactor(),
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof build> | undefined;

export function auth(): ReturnType<typeof build> {
  if (!instance) instance = build();
  return instance;
}
