import { CommandState, IntegrationCursorHealth, IsoDateTime, Uuid } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { CommandRow } from "./commands";

/** OPS-01: one correlation id, every trace it left, before any log. */
export const OpsAttempt = z.object({
  id: Uuid,
  commandId: Uuid,
  attemptNumber: z.number().int().positive(),
  step: z.string(),
  outcome: z.string(),
  httpStatus: z.number().int().nullable(),
  providerFault: z.string().nullable(),
  createdAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type OpsAttempt = z.infer<typeof OpsAttempt>;

export const OpsExchange = z.object({
  id: Uuid,
  integration: z.string(),
  direction: z.string(),
  operation: z.string(),
  status: z.string(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  errorDetail: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type OpsExchange = z.infer<typeof OpsExchange>;

export const OpsJob = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  createdOn: IsoDateTime.nullable(),
  completedOn: IsoDateTime.nullable(),
  output: z.string().nullable(),
});
export type OpsJob = z.infer<typeof OpsJob>;

export const OpsSearchResult = z.object({
  requestId: Uuid,
  commands: z.array(CommandRow),
  attempts: z.array(OpsAttempt),
  exchanges: z.array(OpsExchange),
  jobs: z.array(OpsJob),
  /** false when the pg-boss schema is not installed yet; not the same as "no jobs". */
  queueAvailable: z.boolean(),
});
export type OpsSearchResult = z.infer<typeof OpsSearchResult>;

export const OpsQueuesResult = z.object({
  available: z.boolean(),
  queues: z.array(
    z.object({ name: z.string(), state: z.string(), count: z.number().int().nonnegative() }),
  ),
  outbox: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative() })),
  commands: z.array(z.object({ status: CommandState, count: z.number().int().nonnegative() })),
});
export type OpsQueuesResult = z.infer<typeof OpsQueuesResult>;

export const OpsIntegrationsResult = z.object({
  integrations: z.array(
    z.object({
      connector: z.string(),
      stream: z.string(),
      health: IntegrationCursorHealth,
      cursorValue: z.string().nullable(),
      lastSuccessAt: IsoDateTime.nullable(),
      lastAttemptAt: IsoDateTime.nullable(),
      lastError: z.string().nullable(),
      consecutiveFailures: z.number().int().nonnegative(),
      lastExchangeAt: IsoDateTime.nullable(),
      lastExchangeStatus: z.string().nullable(),
    }),
  ),
});
export type OpsIntegrationsResult = z.infer<typeof OpsIntegrationsResult>;

export const opsProcedures = {
  search: oc
    .route({ method: "GET", path: "/ops/search", summary: "Tracer une référence" })
    .input(z.object({ requestId: Uuid }))
    .output(OpsSearchResult),
  queues: oc
    .route({ method: "GET", path: "/ops/queues", summary: "État des files" })
    .output(OpsQueuesResult),
  integrations: oc
    .route({ method: "GET", path: "/ops/integrations", summary: "Santé des connecteurs" })
    .output(OpsIntegrationsResult),
};
