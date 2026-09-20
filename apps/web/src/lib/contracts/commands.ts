import {
  ApprovalDecision,
  CommandAutonomyLevel,
  CommandEnvelope,
  CommandState,
  CommandType,
  IsoDateTime,
  Money,
  ObjectRef,
  SubmitCommandOutput,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const CommandRow = z.object({
  id: Uuid,
  version: Version,
  commandType: z.string(),
  operationKey: z.string(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: CommandState,
  autonomyLevel: CommandAutonomyLevel,
  errorType: z.string().nullable(),
  errorDetail: z.string().nullable(),
  correlationId: Uuid,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime.nullable(),
});
export type CommandRow = z.infer<typeof CommandRow>;

export const CommandDetail = CommandRow.extend({
  payload: z.record(z.string(), z.unknown()),
  targetObject: ObjectRef.nullable(),
  attempts: z.array(
    z.object({
      id: Uuid,
      attemptNumber: z.number().int().positive(),
      step: z.string(),
      outcome: z.string(),
      httpStatus: z.number().int().nullable(),
      providerFault: z.string().nullable(),
      createdAt: IsoDateTime,
      finishedAt: IsoDateTime.nullable(),
    }),
  ),
});
export type CommandDetail = z.infer<typeof CommandDetail>;

/** IA-03: the card shows the pieces, the expected effect and lets the owner refuse with a reason. */
export const PendingApproval = z.object({
  commandId: Uuid,
  version: Version,
  commandType: z.string(),
  level: CommandAutonomyLevel,
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  what: z.string(),
  amount: Money.nullable(),
  currency: z.string().length(3),
  pieces: z.array(z.string()),
  expectedEffect: z.string(),
  targetObject: ObjectRef.nullable(),
  createdAt: IsoDateTime,
});
export type PendingApproval = z.infer<typeof PendingApproval>;

export const DecidedApproval = z.object({
  approvalId: Uuid,
  commandId: Uuid,
  commandType: z.string(),
  decision: ApprovalDecision,
  reason: z.string().nullable(),
  decidedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
});
export type DecidedApproval = z.infer<typeof DecidedApproval>;

export const ApprovalsPendingResult = z.object({
  pending: z.array(PendingApproval),
  decided: z.array(DecidedApproval),
});
export type ApprovalsPendingResult = z.infer<typeof ApprovalsPendingResult>;

export const commandsContract = {
  commands: {
    list: oc
      .route({ method: "GET", path: "/commands", summary: "Commandes externes" })
      .input(
        z.object({
          status: CommandState.optional(),
          commandType: CommandType.optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .output(z.object({ items: z.array(CommandRow) })),
    get: oc
      .route({ method: "GET", path: "/commands/{id}", summary: "Détail d’une commande" })
      .input(z.object({ id: Uuid }))
      .output(CommandDetail),
    submit: oc
      .route({ method: "POST", path: "/commands", summary: "Soumettre une commande" })
      .input(CommandEnvelope)
      .output(SubmitCommandOutput),
  },
  approvals: {
    pending: oc
      .route({ method: "GET", path: "/approvals", summary: "Validations en attente" })
      .input(z.object({ historyLimit: z.number().int().min(0).max(100).default(20) }))
      .output(ApprovalsPendingResult),
    decide: oc
      .route({ method: "POST", path: "/approvals", summary: "Valider ou refuser" })
      .input(
        z.object({
          commandId: Uuid,
          expectedVersion: Version,
          payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
          decision: ApprovalDecision,
          reason: z.string().min(1).max(500).optional(),
        }),
      )
      .output(z.object({ commandId: Uuid, status: CommandState })),
  },
};
