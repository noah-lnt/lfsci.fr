import type { CommandPayload, CommandType, DecisionLevel } from "@lfsci/contracts";

export const APPROVAL_TTL_HOURS = 24;

/** IA-03: an approval expires; the default window is a working day. */
export function approvalExpiry(now: Date): string {
  return new Date(now.getTime() + APPROVAL_TTL_HOURS * 3_600_000).toISOString();
}

/** §17.1: A and B go straight to the outbox, C and D wait for the owner. */
export function needsApproval(level: DecisionLevel): boolean {
  return level === "C" || level === "D";
}

const LABEL: Record<CommandType, string> = {
  prepare_rent_accounting: "Comptabiliser un terme de loyer",
  post_supplier_bill: "Comptabiliser une facture fournisseur",
  propose_reconciliation: "Affecter un encaissement",
  issue_receipt: "Émettre une quittance",
  send_message: "Envoyer un message",
  revise_rent: "Réviser un loyer",
  activate_rule: "Activer une règle",
  record_cca_movement: "Enregistrer un mouvement de compte courant",
  close_intervention: "Clôturer une intervention",
  convert_acquisition: "Convertir une acquisition",
  attach_document_to_odoo: "Rattacher une pièce à Odoo",
};

const EFFECT: Record<CommandType, string> = {
  prepare_rent_accounting: "Une écriture de loyer est créée dans Odoo pour la période indiquée.",
  post_supplier_bill: "La facture est comptabilisée et la dette fournisseur apparaît dans Odoo.",
  propose_reconciliation: "Le paiement est lettré sur les termes choisis.",
  issue_receipt: "La quittance est émise et devient communicable au locataire.",
  send_message: "Le message part vers le destinataire ; l’envoi est irréversible.",
  revise_rent: "Le loyer du bail change à compter de la date d’effet.",
  activate_rule: "La règle s’applique aux affectations suivantes.",
  record_cca_movement: "Le solde du compte courant d’associé est modifié.",
  close_intervention: "L’intervention est close et son contrôle de suivi est planifié.",
  convert_acquisition: "L’immeuble, les lots et le financement sont créés puis rattachés.",
  attach_document_to_odoo: "La pièce est jointe à l’enregistrement Odoo visé.",
};

function sum(values: { amount: string }[]): string {
  return values.reduce((total, entry) => total + Number(entry.amount), 0).toFixed(2);
}

export type CommandSummary = {
  what: string;
  amount: string | null;
  currency: string;
  pieces: string[];
  expectedEffect: string;
};

/** What the approval card shows: the act, the amount, the pieces, the effect. */
export function describeCommand(envelope: CommandPayload): CommandSummary {
  const base = {
    what: LABEL[envelope.command],
    expectedEffect: EFFECT[envelope.command],
    currency: "EUR",
    amount: null as string | null,
    pieces: [] as string[],
  };

  switch (envelope.command) {
    case "prepare_rent_accounting":
      return {
        ...base,
        amount: envelope.payload.totalAmount,
        currency: envelope.payload.currency,
        pieces: [
          `terme ${envelope.payload.rentTermId}`,
          `période ${envelope.payload.periodStart} → ${envelope.payload.periodEnd}`,
        ],
      };
    case "post_supplier_bill":
      return {
        ...base,
        amount: envelope.payload.totalInclTax,
        currency: envelope.payload.currency,
        pieces: [
          `facture ${envelope.payload.supplierReference}`,
          `dépense ${envelope.payload.expenseId}`,
        ],
      };
    case "propose_reconciliation":
      return {
        ...base,
        amount: sum(envelope.payload.allocations),
        currency: envelope.payload.currency,
        pieces: [
          `paiement ${envelope.payload.paymentId}`,
          `${envelope.payload.allocations.length} affectation(s)`,
        ],
      };
    case "issue_receipt":
      return {
        ...base,
        amount: envelope.payload.totalAmount,
        currency: envelope.payload.currency,
        pieces: [
          `bail ${envelope.payload.leaseId}`,
          `période ${envelope.payload.periodStart} → ${envelope.payload.periodEnd}`,
        ],
      };
    case "send_message":
      return {
        ...base,
        pieces: [
          `canal ${envelope.payload.channel}`,
          `modèle ${envelope.payload.templateCode} v${envelope.payload.templateVersion}`,
        ],
      };
    case "revise_rent":
      return {
        ...base,
        amount: envelope.payload.proposedRent,
        currency: envelope.payload.currency,
        pieces: [
          `bail ${envelope.payload.leaseId}`,
          `indice ${envelope.payload.indexName} ${envelope.payload.referenceQuarter}`,
        ],
      };
    case "activate_rule":
      return {
        ...base,
        pieces: [`règle ${envelope.payload.ruleId}`, `version ${envelope.payload.ruleVersionId}`],
      };
    case "record_cca_movement":
      return {
        ...base,
        amount: envelope.payload.amount,
        currency: envelope.payload.currency,
        pieces: [`compte ${envelope.payload.ccaId}`, envelope.payload.justification],
      };
    case "close_intervention":
      return {
        ...base,
        pieces: [
          `intervention ${envelope.payload.interventionId}`,
          envelope.payload.observedResult,
        ],
      };
    case "convert_acquisition":
      return {
        ...base,
        amount: envelope.payload.acquisitionPrice,
        currency: envelope.payload.currency,
        pieces: [`opportunité ${envelope.payload.opportunityId}`, envelope.payload.buildingName],
      };
    case "attach_document_to_odoo":
      return {
        ...base,
        pieces: [
          `document ${envelope.payload.documentId}`,
          `${envelope.payload.odooModel} #${envelope.payload.odooRecordId}`,
        ],
      };
    default:
      return base satisfies CommandSummary;
  }
}
