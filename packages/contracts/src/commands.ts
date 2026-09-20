import { z } from "zod";
import { ObjectRef } from "./entities/common";
import {
  CcaMovementKind,
  CommandStatus,
  MessageOutboundChannel,
  RentReceiptKind,
  RentTermKind,
} from "./enums";
import { Currency, IsoDate, Money, Uuid, Version } from "./primitives";

/** Spec §16.1 ARC-02: the SaaS exposes business commands, never generic Odoo model access. */
export const CommandType = z.enum([
  "prepare_rent_accounting",
  "post_supplier_bill",
  "propose_reconciliation",
  "issue_receipt",
  "send_message",
  "revise_rent",
  "activate_rule",
  "record_cca_movement",
  "close_intervention",
  "convert_acquisition",
  "attach_document_to_odoo",
]);
export type CommandType = z.infer<typeof CommandType>;

export const PrepareRentAccountingPayload = z.strictObject({
  rentTermId: Uuid,
  kind: RentTermKind,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  dueOn: IsoDate,
  rentAmount: Money,
  chargeAmount: Money,
  accessoryAmount: Money,
  totalAmount: Money,
  currency: Currency,
});

export const PostSupplierBillPayload = z.strictObject({
  expenseId: Uuid,
  supplierId: Uuid,
  supplierReference: z.string().min(1),
  issuedOn: IsoDate,
  totalExclTax: Money,
  taxAmount: Money,
  totalInclTax: Money,
  currency: Currency,
  isNewSupplier: z.boolean(),
  paymentIdentityChanged: z.boolean(),
});

export const ProposeReconciliationPayload = z.strictObject({
  paymentId: Uuid,
  bankTransactionId: Uuid,
  allocations: z.array(z.strictObject({ rentTermId: Uuid, amount: Money })).min(1),
  currency: Currency,
});

export const IssueReceiptPayload = z.strictObject({
  leaseId: Uuid,
  kind: RentReceiptKind,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  rentAmount: Money,
  chargeAmount: Money,
  totalAmount: Money,
  currency: Currency,
  issuedOn: IsoDate,
});

export const SendMessagePayload = z.strictObject({
  channel: MessageOutboundChannel,
  recipientPersonId: Uuid,
  recipientContactPointId: Uuid,
  templateCode: z.string().min(1),
  templateVersion: z.string().min(1),
  subject: z.string().nullable(),
  body: z.string().min(1),
  relatedObject: ObjectRef.nullable(),
  dedupKey: z.string().min(1),
});

export const ReviseRentPayload = z.strictObject({
  leaseId: Uuid,
  rentRevisionId: Uuid,
  indexName: z.enum(["irl", "ilc", "ilat"]),
  referenceQuarter: z.string().min(1),
  previousIndexValue: z.string(),
  newIndexValue: z.string(),
  baseRent: Money,
  proposedRent: Money,
  currency: Currency,
  effectiveOn: IsoDate,
});

export const ActivateRulePayload = z.strictObject({
  ruleId: Uuid,
  ruleVersionId: Uuid,
  definitionHash: z.string().regex(/^[0-9a-f]{64}$/),
  effectiveFrom: IsoDate,
});

export const RecordCcaMovementPayload = z.strictObject({
  ccaId: Uuid,
  ccaMovementId: Uuid,
  kind: CcaMovementKind,
  amount: Money,
  currency: Currency,
  occurredOn: IsoDate,
  expenseId: Uuid.nullable(),
  justification: z.string().min(1),
});

export const CloseInterventionPayload = z.strictObject({
  interventionId: Uuid,
  completedOn: IsoDate,
  observedResult: z.string().min(1),
  nextCheckOn: IsoDate.nullable(),
});

export const ConvertAcquisitionPayload = z.strictObject({
  opportunityId: Uuid,
  legalEntityId: Uuid,
  buildingCode: z.string().min(1),
  buildingName: z.string().min(1),
  signedOn: IsoDate,
  acquisitionPrice: Money,
  currency: Currency,
});

export const AttachDocumentToOdooPayload = z.strictObject({
  documentId: Uuid,
  documentVersionId: Uuid,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  odooModel: z.string().min(1),
  odooRecordId: z.number().int().positive(),
});

export const commandPayloads = {
  prepare_rent_accounting: PrepareRentAccountingPayload,
  post_supplier_bill: PostSupplierBillPayload,
  propose_reconciliation: ProposeReconciliationPayload,
  issue_receipt: IssueReceiptPayload,
  send_message: SendMessagePayload,
  revise_rent: ReviseRentPayload,
  activate_rule: ActivateRulePayload,
  record_cca_movement: RecordCcaMovementPayload,
  close_intervention: CloseInterventionPayload,
  convert_acquisition: ConvertAcquisitionPayload,
  attach_document_to_odoo: AttachDocumentToOdooPayload,
} as const satisfies Record<CommandType, z.ZodObject>;

export const CommandPayload = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("prepare_rent_accounting"),
    payload: PrepareRentAccountingPayload,
  }),
  z.object({ command: z.literal("post_supplier_bill"), payload: PostSupplierBillPayload }),
  z.object({ command: z.literal("propose_reconciliation"), payload: ProposeReconciliationPayload }),
  z.object({ command: z.literal("issue_receipt"), payload: IssueReceiptPayload }),
  z.object({ command: z.literal("send_message"), payload: SendMessagePayload }),
  z.object({ command: z.literal("revise_rent"), payload: ReviseRentPayload }),
  z.object({ command: z.literal("activate_rule"), payload: ActivateRulePayload }),
  z.object({ command: z.literal("record_cca_movement"), payload: RecordCcaMovementPayload }),
  z.object({ command: z.literal("close_intervention"), payload: CloseInterventionPayload }),
  z.object({ command: z.literal("convert_acquisition"), payload: ConvertAcquisitionPayload }),
  z.object({ command: z.literal("attach_document_to_odoo"), payload: AttachDocumentToOdooPayload }),
]);
export type CommandPayload = z.infer<typeof CommandPayload>;

const envelopeBase = {
  operationId: Uuid,
  objectId: Uuid,
  expectedVersion: Version.nullable(),
  ruleVersion: z.string().min(1).nullable(),
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/, "sha256 hexadécimal attendu"),
  approvalId: Uuid.optional(),
  requestId: Uuid,
};

/** ARC-02 envelope: the command and its payload cannot disagree on the shape. */
export const CommandEnvelope = z.discriminatedUnion("command", [
  z.object({
    ...envelopeBase,
    command: z.literal("prepare_rent_accounting"),
    payload: PrepareRentAccountingPayload,
  }),
  z.object({
    ...envelopeBase,
    command: z.literal("post_supplier_bill"),
    payload: PostSupplierBillPayload,
  }),
  z.object({
    ...envelopeBase,
    command: z.literal("propose_reconciliation"),
    payload: ProposeReconciliationPayload,
  }),
  z.object({ ...envelopeBase, command: z.literal("issue_receipt"), payload: IssueReceiptPayload }),
  z.object({ ...envelopeBase, command: z.literal("send_message"), payload: SendMessagePayload }),
  z.object({ ...envelopeBase, command: z.literal("revise_rent"), payload: ReviseRentPayload }),
  z.object({ ...envelopeBase, command: z.literal("activate_rule"), payload: ActivateRulePayload }),
  z.object({
    ...envelopeBase,
    command: z.literal("record_cca_movement"),
    payload: RecordCcaMovementPayload,
  }),
  z.object({
    ...envelopeBase,
    command: z.literal("close_intervention"),
    payload: CloseInterventionPayload,
  }),
  z.object({
    ...envelopeBase,
    command: z.literal("convert_acquisition"),
    payload: ConvertAcquisitionPayload,
  }),
  z.object({
    ...envelopeBase,
    command: z.literal("attach_document_to_odoo"),
    payload: AttachDocumentToOdooPayload,
  }),
]);
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

/** Spec §13.3 / SQL `command.status`. */
export const CommandState = CommandStatus;
export type CommandState = z.infer<typeof CommandState>;

/** Spec §17.1 decision levels. */
export const DecisionLevel = z.enum(["A", "B", "C", "D"]);
export type DecisionLevel = z.infer<typeof DecisionLevel>;

/**
 * Base level per command (§17.1). `post_supplier_bill` is C for a known supplier
 * with an unchanged payment identity and D otherwise — `resolveDecisionLevel`
 * applies that escalation; the table never lowers a level.
 */
export const decisionLevelByCommand = {
  prepare_rent_accounting: "C",
  post_supplier_bill: "C",
  propose_reconciliation: "C",
  issue_receipt: "B",
  send_message: "C",
  revise_rent: "D",
  activate_rule: "D",
  record_cca_movement: "D",
  close_intervention: "B",
  convert_acquisition: "D",
  attach_document_to_odoo: "B",
} as const satisfies Record<CommandType, DecisionLevel>;

export const resolveDecisionLevel = (
  command: CommandType,
  context: { isNewSupplier?: boolean; paymentIdentityChanged?: boolean } = {},
): DecisionLevel => {
  if (
    command === "post_supplier_bill" &&
    (context.isNewSupplier === true || context.paymentIdentityChanged === true)
  ) {
    return "D";
  }
  return decisionLevelByCommand[command];
};

export const SubmitCommandOutput = z.object({ commandId: Uuid, status: CommandState });
export type SubmitCommandOutput = z.infer<typeof SubmitCommandOutput>;
