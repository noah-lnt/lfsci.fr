import { z } from "zod";
import { CommandState } from "../commands";
import { Command, IntegrationHealth, listInput, paginated } from "../entities";
import { IsoDateTime, Uuid } from "../primitives";

/** OPS-01: the ops screen is searched by correlation id before any log. */
export const searchCommandsByRequestId = {
  input: listInput({ requestId: Uuid, status: CommandState.optional() }),
  output: paginated(Command),
};

export const NightlyControlReport = z.object({
  runAt: IsoDateTime,
  expected: z.number().int().nonnegative(),
  executed: z.number().int().nonnegative(),
  failed: z.array(z.string()),
});
export type NightlyControlReport = z.infer<typeof NightlyControlReport>;

export const getHealth = {
  input: z.strictObject({ connector: z.string().optional() }),
  output: z.object({
    integrations: z.array(IntegrationHealth),
    queue: z.object({
      pending: z.number().int().nonnegative(),
      leased: z.number().int().nonnegative(),
      deadLetter: z.number().int().nonnegative(),
    }),
    lastNightlyReport: NightlyControlReport.nullable(),
  }),
};
