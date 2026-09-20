import { z } from "zod";
import { ObjectRef } from "./entities/common";
// ApprovalDecision itself is exported from ./enums (SQL `approval.decision`);
// re-exporting it here too would make the package index ambiguous.
import { ApprovalDecision } from "./enums";
import { Audited, IsoDateTime, Uuid } from "./primitives";

/** IA-03: an approval binds one exact payload hash, a scope, an actor and an expiry. */
export const Approval = Audited.extend({
  commandId: Uuid,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hexadécimal attendu"),
  decision: ApprovalDecision,
  reason: z.string().nullable(),
  scope: z.record(z.string(), z.unknown()),
  ruleVersionId: Uuid.nullable(),
  decidedBy: Uuid,
  decidedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
  evidenceObject: ObjectRef.nullable(),
});
export type Approval = z.infer<typeof Approval>;

export const CreateApprovalInput = z
  .strictObject({
    commandId: Uuid,
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    decision: ApprovalDecision,
    reason: z.string().min(1).optional(),
    scope: z.record(z.string(), z.unknown()).optional(),
    ruleVersionId: Uuid.optional(),
    expiresAt: IsoDateTime,
  })
  .refine((input) => input.decision === "approved" || input.reason !== undefined, {
    message: "un refus doit être motivé",
    path: ["reason"],
  });
export type CreateApprovalInput = z.infer<typeof CreateApprovalInput>;
