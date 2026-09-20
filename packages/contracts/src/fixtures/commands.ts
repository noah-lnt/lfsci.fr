import type { z } from "zod";
import type * as C from "../commands";
import { ids, sha256Fixture } from "./ids";

export const prepareRentAccountingPayloadFixture: z.infer<typeof C.PrepareRentAccountingPayload> = {
  rentTermId: ids.rentTerm,
  kind: "rent",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  dueOn: "2026-03-05",
  rentAmount: "780.00",
  chargeAmount: "120.00",
  accessoryAmount: "0.00",
  totalAmount: "900.00",
  currency: "EUR",
};

export const postSupplierBillPayloadFixture: z.infer<typeof C.PostSupplierBillPayload> = {
  expenseId: ids.expense,
  supplierId: ids.supplier,
  supplierReference: "F2026-0451",
  issuedOn: "2026-02-20",
  totalExclTax: "320.00",
  taxAmount: "64.00",
  totalInclTax: "384.00",
  currency: "EUR",
  isNewSupplier: false,
  paymentIdentityChanged: false,
};

export const proposeReconciliationPayloadFixture: z.infer<typeof C.ProposeReconciliationPayload> = {
  paymentId: ids.payment,
  bankTransactionId: ids.bankTransaction,
  allocations: [{ rentTermId: ids.rentTerm, amount: "900.00" }],
  currency: "EUR",
};

export const issueReceiptPayloadFixture: z.infer<typeof C.IssueReceiptPayload> = {
  leaseId: ids.lease,
  kind: "quittance",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  rentAmount: "780.00",
  chargeAmount: "120.00",
  totalAmount: "900.00",
  currency: "EUR",
  issuedOn: "2026-03-06",
};

export const sendMessagePayloadFixture: z.infer<typeof C.SendMessagePayload> = {
  channel: "email",
  recipientPersonId: ids.person,
  recipientContactPointId: ids.contactPoint,
  templateCode: "quittance_envoi",
  templateVersion: "2026-01",
  subject: "Votre quittance de mars 2026",
  body: "Bonjour Camille Martin, veuillez trouver votre quittance en pièce jointe.",
  relatedObject: { kind: "lease", id: ids.lease },
  dedupKey: `quittance:2026-03:${ids.lease}`,
};

export const reviseRentPayloadFixture: z.infer<typeof C.ReviseRentPayload> = {
  leaseId: ids.lease,
  rentRevisionId: ids.ruleVersion,
  indexName: "irl",
  referenceQuarter: "2025-T4",
  previousIndexValue: "145.470000",
  newIndexValue: "148.380000",
  baseRent: "780.00",
  proposedRent: "795.60",
  currency: "EUR",
  effectiveOn: "2027-02-01",
};

export const activateRulePayloadFixture: z.infer<typeof C.ActivateRulePayload> = {
  ruleId: ids.rule,
  ruleVersionId: ids.ruleVersion,
  definitionHash: sha256Fixture,
  effectiveFrom: "2026-01-01",
};

export const recordCcaMovementPayloadFixture: z.infer<typeof C.RecordCcaMovementPayload> = {
  ccaId: ids.cca,
  ccaMovementId: ids.ccaMovement,
  kind: "expense_paid_personally",
  amount: "384.00",
  currency: "EUR",
  occurredOn: "2026-02-20",
  expenseId: ids.expense,
  justification: "Facture plomberie réglée par l'associé.",
};

export const closeInterventionPayloadFixture: z.infer<typeof C.CloseInterventionPayload> = {
  interventionId: ids.intervention,
  completedOn: "2026-02-20",
  observedResult: "Mitigeur remplacé, aucune trace d'humidité résiduelle.",
  nextCheckOn: "2026-08-20",
};

export const convertAcquisitionPayloadFixture: z.infer<typeof C.ConvertAcquisitionPayload> = {
  opportunityId: ids.opportunity,
  legalEntityId: ids.legalEntity,
  buildingCode: "ACACIAS",
  buildingName: "Immeuble des Acacias",
  signedOn: "2026-06-15",
  acquisitionPrice: "285000.00",
  currency: "EUR",
};

export const attachDocumentToOdooPayloadFixture: z.infer<typeof C.AttachDocumentToOdooPayload> = {
  documentId: ids.document,
  documentVersionId: ids.documentVersion,
  sha256: sha256Fixture,
  odooModel: "account.move",
  odooRecordId: 3141,
};

export const commandPayloadFixtures = {
  prepare_rent_accounting: prepareRentAccountingPayloadFixture,
  post_supplier_bill: postSupplierBillPayloadFixture,
  propose_reconciliation: proposeReconciliationPayloadFixture,
  issue_receipt: issueReceiptPayloadFixture,
  send_message: sendMessagePayloadFixture,
  revise_rent: reviseRentPayloadFixture,
  activate_rule: activateRulePayloadFixture,
  record_cca_movement: recordCcaMovementPayloadFixture,
  close_intervention: closeInterventionPayloadFixture,
  convert_acquisition: convertAcquisitionPayloadFixture,
  attach_document_to_odoo: attachDocumentToOdooPayloadFixture,
} as const;

const envelopeCommon = {
  operationId: ids.operation,
  expectedVersion: 1,
  ruleVersion: "rent-policy-validated",
  payloadHash: sha256Fixture,
  approvalId: ids.approval,
  requestId: ids.request,
};

export const commandEnvelopeFixture: z.infer<typeof C.CommandEnvelope> = {
  ...envelopeCommon,
  command: "prepare_rent_accounting",
  objectId: ids.rentTerm,
  payload: prepareRentAccountingPayloadFixture,
};

export const commandEnvelopeFixtures = {
  prepare_rent_accounting: commandEnvelopeFixture,
  post_supplier_bill: {
    ...envelopeCommon,
    command: "post_supplier_bill",
    objectId: ids.expense,
    payload: postSupplierBillPayloadFixture,
  },
  propose_reconciliation: {
    ...envelopeCommon,
    command: "propose_reconciliation",
    objectId: ids.payment,
    payload: proposeReconciliationPayloadFixture,
  },
  issue_receipt: {
    ...envelopeCommon,
    command: "issue_receipt",
    objectId: ids.lease,
    payload: issueReceiptPayloadFixture,
  },
  send_message: {
    ...envelopeCommon,
    command: "send_message",
    objectId: ids.person,
    payload: sendMessagePayloadFixture,
  },
  revise_rent: {
    ...envelopeCommon,
    command: "revise_rent",
    objectId: ids.lease,
    payload: reviseRentPayloadFixture,
  },
  activate_rule: {
    ...envelopeCommon,
    command: "activate_rule",
    objectId: ids.rule,
    payload: activateRulePayloadFixture,
  },
  record_cca_movement: {
    ...envelopeCommon,
    command: "record_cca_movement",
    objectId: ids.cca,
    payload: recordCcaMovementPayloadFixture,
  },
  close_intervention: {
    ...envelopeCommon,
    command: "close_intervention",
    objectId: ids.intervention,
    payload: closeInterventionPayloadFixture,
  },
  convert_acquisition: {
    ...envelopeCommon,
    command: "convert_acquisition",
    objectId: ids.opportunity,
    payload: convertAcquisitionPayloadFixture,
  },
  attach_document_to_odoo: {
    ...envelopeCommon,
    command: "attach_document_to_odoo",
    objectId: ids.document,
    payload: attachDocumentToOdooPayloadFixture,
  },
} as const satisfies Record<string, z.infer<typeof C.CommandEnvelope>>;

export const approvalFixture = {
  id: ids.approval,
  createdAt: "2026-03-01T06:00:00+01:00",
  updatedAt: null,
  version: 1,
  commandId: ids.command,
  payloadHash: sha256Fixture,
  decision: "approved",
  reason: null,
  scope: { legalEntityId: ids.legalEntity, maxAmount: "1000.00" },
  ruleVersionId: ids.ruleVersion,
  decidedBy: ids.user,
  decidedAt: "2026-03-01T06:05:00+01:00",
  expiresAt: "2026-03-02T06:05:00+01:00",
  revokedAt: null,
  evidenceObject: { kind: "rent_term", id: ids.rentTerm },
} as const;

export const createApprovalInputFixture = {
  commandId: ids.command,
  payloadHash: sha256Fixture,
  decision: "approved",
  scope: { legalEntityId: ids.legalEntity },
  ruleVersionId: ids.ruleVersion,
  expiresAt: "2026-03-02T06:05:00+01:00",
} as const;
