import type { ReminderLevel } from "@lfsci/domain";

/**
 * MSG-01: a sent message records the template and the version that produced it.
 * Bump the version whenever a body changes, so an old message stays explainable.
 */
export const REMINDER_TEMPLATE_VERSION = "2026-09-20.1";

export type ReminderTerm = {
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  outstanding: string;
};

export type ReminderVariables = {
  tenantName: string;
  landlordName: string;
  leaseReference: string;
  unitLabel: string | null;
  currency: string;
  outstanding: string;
  oldestDueOn: string;
  daysLate: number;
  terms: readonly ReminderTerm[];
  contact: string;
};

export type RenderedMessage = {
  templateCode: string;
  templateVersion: string;
  subject: string;
  text: string;
};

export const reminderTemplateCodes: Record<ReminderLevel, string> = {
  reminder_1: "rent_reminder_simple",
  reminder_2: "rent_reminder_firm",
  formal_notice: "rent_formal_notice",
};

export const reminderTemplateLabels: Record<ReminderLevel, string> = {
  reminder_1: "Relance simple",
  reminder_2: "Relance ferme",
  formal_notice: "Mise en demeure",
};

function formatDate(value: string): string {
  const [year = "", month = "", day = ""] = value.split("-");
  return `${day}/${month}/${year}`;
}

function amount(value: string, currency: string): string {
  return `${value.replace(".", ",")} ${currency}`;
}

function detail(vars: ReminderVariables): string {
  return vars.terms
    .map(
      (term) =>
        `- période du ${formatDate(term.periodStart)} au ${formatDate(term.periodEnd)}, exigible le ${formatDate(term.dueOn)} : ${amount(term.outstanding, vars.currency)}`,
    )
    .join("\n");
}

function header(vars: ReminderVariables): string {
  const unit = vars.unitLabel ? ` (${vars.unitLabel})` : "";
  return `Bail ${vars.leaseReference}${unit}`;
}

function signature(vars: ReminderVariables): string {
  return `${vars.landlordName}\n${vars.contact}`;
}

const bodies: Record<ReminderLevel, (vars: ReminderVariables) => string> = {
  reminder_1: (vars) =>
    [
      `Madame, Monsieur ${vars.tenantName},`,
      "",
      `${header(vars)}.`,
      "",
      `Sauf erreur de notre part, la somme de ${amount(vars.outstanding, vars.currency)} reste due au titre de votre location, la plus ancienne échéance datant du ${formatDate(vars.oldestDueOn)}.`,
      "",
      "Détail :",
      detail(vars),
      "",
      "Si votre règlement a été émis entre-temps, merci de ne pas tenir compte de ce message et de nous indiquer sa date.",
      "",
      "Nous restons à votre disposition pour convenir d’une solution.",
      "",
      signature(vars),
    ].join("\n"),

  reminder_2: (vars) =>
    [
      `Madame, Monsieur ${vars.tenantName},`,
      "",
      `${header(vars)}.`,
      "",
      `Malgré notre précédent message, la somme de ${amount(vars.outstanding, vars.currency)} demeure impayée, soit ${vars.daysLate} jours de retard depuis l’échéance du ${formatDate(vars.oldestDueOn)}.`,
      "",
      "Détail :",
      detail(vars),
      "",
      "Nous vous demandons de régulariser cette situation sous huitaine, ou de nous contacter afin d’établir un échéancier écrit.",
      "",
      "À défaut de réponse, nous serons conduits à vous adresser une mise en demeure.",
      "",
      signature(vars),
    ].join("\n"),

  formal_notice: (vars) =>
    [
      `Madame, Monsieur ${vars.tenantName},`,
      "",
      `Objet : mise en demeure de payer — ${header(vars)}.`,
      "",
      `Nos relances des dernières semaines sont restées sans effet. À ce jour, la somme de ${amount(vars.outstanding, vars.currency)} reste due, la plus ancienne échéance remontant au ${formatDate(vars.oldestDueOn)}, soit ${vars.daysLate} jours de retard.`,
      "",
      "Détail :",
      detail(vars),
      "",
      "Par la présente, nous vous mettons en demeure de régler cette somme dans un délai de quinze jours à compter de la réception de ce message.",
      "",
      "À défaut, nous nous réservons le droit de faire valoir les garanties du bail et d’engager toute procédure utile au recouvrement.",
      "",
      "Nous restons disposés à examiner toute proposition de règlement écrite reçue dans ce délai.",
      "",
      signature(vars),
    ].join("\n"),
};

const subjects: Record<ReminderLevel, (vars: ReminderVariables) => string> = {
  reminder_1: (vars) => `Loyer en attente — bail ${vars.leaseReference}`,
  reminder_2: (vars) => `Relance — loyer impayé, bail ${vars.leaseReference}`,
  formal_notice: (vars) => `Mise en demeure de payer — bail ${vars.leaseReference}`,
};

export function renderReminder(level: ReminderLevel, vars: ReminderVariables): RenderedMessage {
  return {
    templateCode: reminderTemplateCodes[level],
    templateVersion: REMINDER_TEMPLATE_VERSION,
    subject: subjects[level](vars),
    text: bodies[level](vars),
  };
}
