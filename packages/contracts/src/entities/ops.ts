import { z } from "zod";
import {
  AiExtractionDecision,
  CommandAttemptOutcome,
  CommandAutonomyLevel,
  CommandErrorType,
  CommandStatus,
  IntegrationCursorHealth,
} from "../enums";
import { Audited, IsoDateTime, Share, Uuid, Version } from "../primitives";
import { ObjectRef } from "./common";

export const CommandAttempt = Audited.extend({
  commandId: Uuid,
  attemptNumber: z.number().int().positive(),
  step: z.string(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  outcome: CommandAttemptOutcome,
  httpStatus: z.number().int().nullable(),
  providerFault: z.string().nullable(),
  responseExcerpt: z.string().nullable(),
  workerId: z.string().nullable(),
});
export type CommandAttempt = z.infer<typeof CommandAttempt>;

export const Command = Audited.extend({
  commandType: z.string(),
  operationKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  targetObject: ObjectRef.nullable(),
  expectedVersion: Version.nullable(),
  ruleVersionId: Uuid.nullable(),
  approvalId: Uuid.nullable(),
  actorUserId: Uuid.nullable(),
  autonomyLevel: CommandAutonomyLevel,
  status: CommandStatus,
  errorType: CommandErrorType.nullable(),
  errorDetail: z.string().nullable(),
  correlationId: Uuid,
  attempts: z.array(CommandAttempt),
});
export type Command = z.infer<typeof Command>;

export const AiExtraction = Audited.extend({
  subjectObject: ObjectRef.nullable(),
  sourceDocumentVersionId: Uuid.nullable(),
  sourceActivityId: Uuid.nullable(),
  inboxItemId: Uuid.nullable(),
  fieldPath: z.string(),
  proposedValue: z.string().nullable(),
  confidence: Share.nullable(),
  evidenceExcerpt: z.string().nullable(),
  evidencePage: z.number().int().nullable(),
  provider: z.string(),
  modelName: z.string(),
  modelVersion: z.string().nullable(),
  promptVersion: z.string().nullable(),
  decision: AiExtractionDecision,
  decidedValue: z.string().nullable(),
  decidedAt: IsoDateTime.nullable(),
  autonomyLevel: CommandAutonomyLevel,
});
export type AiExtraction = z.infer<typeof AiExtraction>;

/** SYN-06: what the dashboard banner and GET /v1/integrations/{id}/health expose. */
export const IntegrationHealth = z.object({
  connector: z.string(),
  stream: z.string(),
  health: IntegrationCursorHealth,
  lastSuccessAt: IsoDateTime.nullable(),
  lastAttemptAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  pendingCommands: z.number().int().nonnegative(),
  lagSeconds: z.number().int().nonnegative().nullable(),
});
export type IntegrationHealth = z.infer<typeof IntegrationHealth>;
