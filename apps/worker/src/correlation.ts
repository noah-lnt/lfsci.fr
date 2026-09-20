import { newId, runWithCorrelation } from "@lfsci/kernel";
import { z } from "zod";

/**
 * Every job payload carries the correlation id the web request started with, so
 * pino children, recordExchange and the Odoo X-Request-Id all read the same
 * value (tech pack §10.1).
 */
export const JobBase = z.object({
  // A scheduled job has no inbound request to inherit from, so it mints its own.
  requestId: z.uuid().default(() => newId()),
  organizationId: z.uuid().optional(),
});
export type JobBase = z.infer<typeof JobBase>;

export function withJobCorrelation<T>(data: JobBase, fn: () => Promise<T>): Promise<T> {
  return runWithCorrelation(
    {
      requestId: data.requestId,
      ...(data.organizationId === undefined ? {} : { organizationId: data.organizationId }),
    },
    fn,
  );
}

/** A job created by a schedule has no inbound request to inherit from. */
export function scheduledCorrelation(organizationId?: string): JobBase {
  return { requestId: newId(), ...(organizationId === undefined ? {} : { organizationId }) };
}
