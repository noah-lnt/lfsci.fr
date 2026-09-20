import type { z } from "zod";
import { Audited, IsoDate, Uuid } from "../primitives";

/** ASS-01: what a policy covers — exactly one object per row (SQL CHECK). */
export const PolicyScope = Audited.extend({
  policyId: Uuid,
  buildingId: Uuid.nullable(),
  unitId: Uuid.nullable(),
  equipmentId: Uuid.nullable(),
  leaseId: Uuid.nullable(),
  loanId: Uuid.nullable(),
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
});
export type PolicyScope = z.infer<typeof PolicyScope>;
