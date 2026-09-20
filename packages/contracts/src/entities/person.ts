import { z } from "zod";
import { ContactPointKind, ContactPointStatus, PersonKind, PersonStatus } from "../enums";
import { Audited, IsoDate, IsoDateTime, Uuid, Version } from "../primitives";

export const Person = Audited.extend({
  kind: PersonKind,
  displayName: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  birthDate: IsoDate.nullable(),
  odooPartnerId: z.number().int().nullable(),
  pseudonymizedAt: IsoDateTime.nullable(),
  retentionHold: z.boolean(),
  status: PersonStatus,
});
export type Person = z.infer<typeof Person>;

export const ContactPoint = Audited.extend({
  personId: Uuid,
  kind: ContactPointKind,
  value: z.string(),
  label: z.string().nullable(),
  isPrimary: z.boolean(),
  verifiedAt: IsoDateTime.nullable(),
  verificationMethod: z.string().nullable(),
  consentElectronicDelivery: z.boolean(),
  consentRecordedAt: IsoDateTime.nullable(),
  validFrom: IsoDate.nullable(),
  validUntil: IsoDate.nullable(),
  status: ContactPointStatus,
});
export type ContactPoint = z.infer<typeof ContactPoint>;

export const CreatePersonInput = z.strictObject({
  kind: PersonKind,
  displayName: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  companyName: z.string().optional(),
  birthDate: IsoDate.optional(),
  contactPoints: z
    .array(
      z.strictObject({
        kind: ContactPointKind,
        value: z.string().min(1),
        label: z.string().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type CreatePersonInput = z.infer<typeof CreatePersonInput>;

export const UpdatePersonInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  displayName: z.string().min(1).optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  companyName: z.string().nullable().optional(),
  birthDate: IsoDate.nullable().optional(),
  retentionHold: z.boolean().optional(),
  status: PersonStatus.optional(),
});
export type UpdatePersonInput = z.infer<typeof UpdatePersonInput>;
