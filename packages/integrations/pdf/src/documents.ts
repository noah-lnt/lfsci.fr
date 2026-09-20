import { DecompteData, RevisionData } from "./schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Civil dates only: a French statement never shows an ISO date. */
export function frDate(value: string): string {
  if (!ISO_DATE.test(value)) return value;
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

function absolute(amount: string): string {
  return amount.startsWith("-") ? amount.slice(1) : amount;
}

export type Party = { nom: string; adresse?: string };

type BaseSource = {
  sci: Party & { siret?: string };
  locataire: Party;
  lot: { designation: string; adresse: string };
  lieu: string;
  signataire: string;
  issuedOn: string;
};

function base(source: BaseSource, periodStart: string, periodEnd: string) {
  return {
    sci: {
      nom: source.sci.nom,
      ...(source.sci.adresse ? { adresse: source.sci.adresse } : {}),
      ...(source.sci.siret ? { siret: source.sci.siret } : {}),
    },
    locataire: {
      nom: source.locataire.nom,
      ...(source.locataire.adresse ? { adresse: source.locataire.adresse } : {}),
    },
    lot: source.lot,
    periode: { debut: frDate(periodStart), fin: frDate(periodEnd) },
    lieu: source.lieu,
    dateEdition: frDate(source.issuedOn),
    signataire: source.signataire,
  };
}

export type DecompteSource = BaseSource & {
  periodStart: string;
  periodEnd: string;
  occupancyStart: string;
  occupancyEnd: string;
  occupancyDays: number;
  periodDays: number;
  postings: {
    label: string;
    recoverableAmount: string;
    keyLabel: string | null;
    quotePart: string;
  }[];
  totalCharges: string;
  provisionsAppelees: string;
  provisionsPayees: string;
  provisionsImpayees: string;
  /** Signed: positive means the tenant still owes, negative means an overpayment. */
  balance: string;
  labels: { directKey: string; owes: string; credit: string; settled: string };
};

/** CHA-02: the statement shows what the run froze, occupancy and unpaid provisions included. */
export function buildDecompteData(source: DecompteSource): DecompteData {
  const owes = !source.balance.startsWith("-") && source.balance !== "0.00";
  const settled = source.balance === "0.00";
  return DecompteData.parse({
    ...base(source, source.periodStart, source.periodEnd),
    exercice: source.periodStart.slice(0, 4),
    occupation: {
      debut: frDate(source.occupancyStart),
      fin: frDate(source.occupancyEnd),
      jours: source.occupancyDays,
      joursPeriode: source.periodDays,
    },
    lignes: source.postings.map((posting) => ({
      libelle: posting.label,
      montantTotal: posting.recoverableAmount,
      cle: posting.keyLabel ?? source.labels.directKey,
      quotePart: posting.quotePart,
    })),
    totalCharges: source.totalCharges,
    provisionsAppelees: source.provisionsAppelees,
    provisionsPayees: source.provisionsPayees,
    provisionsImpayees: source.provisionsImpayees,
    solde: absolute(source.balance),
    libelleSolde: settled
      ? source.labels.settled
      : owes
        ? source.labels.owes
        : source.labels.credit,
  });
}

export type RevisionSource = BaseSource & {
  periodStart: string;
  periodEnd: string;
  indexLabel: string;
  referenceQuarter: string;
  previousIndexValue: string;
  newIndexValue: string;
  baseRent: string;
  proposedRent: string;
  computedRentUnrounded: string;
  /** Signed, computed upstream by the domain: this package never does arithmetic. */
  variation: string;
  chargeAmount: string;
  effectiveOn: string;
  clause: string;
  source: string;
};

/** IRL-01: the letter carries the exact index values and the unrounded quotient. */
export function buildRevisionData(input: RevisionSource): RevisionData {
  return RevisionData.parse({
    ...base(input, input.periodStart, input.periodEnd),
    indice: input.indexLabel,
    trimestreReference: input.referenceQuarter,
    ancienIndice: input.previousIndexValue,
    nouvelIndice: input.newIndexValue,
    loyerActuel: input.baseRent,
    loyerRevise: input.proposedRent,
    loyerReviseNonArrondi: input.computedRentUnrounded,
    variation: input.variation,
    chargesProvision: input.chargeAmount,
    dateEffet: frDate(input.effectiveOn),
    clause: input.clause,
    source: input.source,
  });
}
