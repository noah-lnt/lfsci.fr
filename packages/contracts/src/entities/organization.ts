import { z } from "zod";
import { AppUserStatus, MembershipRole, MembershipStatus, OrganizationStatus } from "../enums";
import { Audited, IsoDate, IsoDateTime, Uuid } from "../primitives";

export const Organization = Audited.extend({
  code: z.string(),
  name: z.string(),
  status: OrganizationStatus,
  defaultCurrency: z.string().length(3),
  displayTimezone: z.string(),
});
export type Organization = z.infer<typeof Organization>;

export const AppUser = Audited.extend({
  email: z.email(),
  fullName: z.string(),
  status: AppUserStatus,
  mfaEnrolledAt: IsoDateTime.nullable(),
  lastLoginAt: IsoDateTime.nullable(),
});
export type AppUser = z.infer<typeof AppUser>;

export const Membership = Audited.extend({
  appUserId: Uuid,
  role: MembershipRole,
  status: MembershipStatus,
  scopeNote: z.string().nullable(),
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
});
export type Membership = z.infer<typeof Membership>;
