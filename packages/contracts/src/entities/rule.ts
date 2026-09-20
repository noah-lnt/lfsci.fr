import { z } from "zod";
import { RuleDomain, RuleOrigin, RuleStatus, RuleVersionStatus } from "../enums";
import { Audited, IsoDate, IsoDateTime, Uuid } from "../primitives";

export const RuleVersionEntity = Audited.extend({
  ruleId: Uuid,
  sequence: z.number().int().positive(),
  definition: z.record(z.string(), z.unknown()),
  definitionHash: z.string().regex(/^[0-9a-f]{64}$/),
  scope: z.record(z.string(), z.unknown()),
  examples: z.array(z.record(z.string(), z.unknown())),
  effectiveFrom: IsoDate,
  effectiveTo: IsoDate.nullable(),
  approvedBy: Uuid.nullable(),
  approvedAt: IsoDateTime.nullable(),
  status: RuleVersionStatus,
});
export type RuleVersionEntity = z.infer<typeof RuleVersionEntity>;

export const Rule = Audited.extend({
  code: z.string(),
  domain: RuleDomain,
  label: z.string(),
  origin: RuleOrigin,
  status: RuleStatus,
  suspendedReason: z.string().nullable(),
  correctionCount: z.number().int().nonnegative(),
  applicationCount: z.number().int().nonnegative(),
  currentVersion: RuleVersionEntity.nullable(),
});
export type Rule = z.infer<typeof Rule>;
