import { z } from "zod";

const Amount = z.string().regex(/^-?\d{1,12}([.,]\d{1,2})?$/, "montant décimal attendu");

const Partie = z.object({ nom: z.string().min(1), adresse: z.string().min(1).optional() });

const Base = z.object({
  sci: Partie.extend({ siret: z.string().min(1).optional() }),
  locataire: Partie,
  lot: z.object({ designation: z.string().min(1), adresse: z.string().min(1) }),
  periode: z.object({ debut: z.string().min(1), fin: z.string().min(1) }),
  lieu: z.string().min(1),
  dateEdition: z.string().min(1),
  signataire: z.string().min(1),
});

export const QuittanceData = Base.extend({
  loyer: Amount,
  provisions: Amount,
  total: Amount,
  datePaiement: z.string().min(1),
});
export type QuittanceData = z.infer<typeof QuittanceData>;

export const RecuData = Base.extend({
  total: Amount,
  montantRecu: Amount,
  resteDu: Amount,
  datePaiement: z.string().min(1),
  modePaiement: z.string().min(1),
});
export type RecuData = z.infer<typeof RecuData>;

export const DecompteData = Base.extend({
  exercice: z.string().min(1),
  occupation: z.object({
    debut: z.string().min(1),
    fin: z.string().min(1),
    jours: z.number().int().nonnegative(),
    joursPeriode: z.number().int().positive(),
  }),
  lignes: z
    .array(
      z.object({
        libelle: z.string().min(1),
        montantTotal: Amount,
        cle: z.string().min(1),
        quotePart: Amount,
      }),
    )
    .min(1),
  totalCharges: Amount,
  provisionsAppelees: Amount,
  provisionsPayees: Amount,
  // CHA-02: les provisions impayées restent une créance du compte locataire ;
  // le décompte les affiche à part et ne les refacture pas.
  provisionsImpayees: Amount,
  solde: Amount,
  libelleSolde: z.string().min(1),
});
export type DecompteData = z.infer<typeof DecompteData>;

export const RevisionData = Base.extend({
  indice: z.string().min(1),
  trimestreReference: z.string().min(1),
  ancienIndice: z.string().min(1),
  nouvelIndice: z.string().min(1),
  loyerActuel: Amount,
  loyerRevise: Amount,
  loyerReviseNonArrondi: z.string().min(1),
  variation: Amount,
  chargesProvision: Amount,
  dateEffet: z.string().min(1),
  clause: z.string().min(1),
  source: z.string().min(1),
});
export type RevisionData = z.infer<typeof RevisionData>;

export const templateSchemas = {
  quittance: QuittanceData,
  recu: RecuData,
  decompte: DecompteData,
  revision: RevisionData,
} as const;

export type TemplateName = keyof typeof templateSchemas;
export type TemplateData = { [K in TemplateName]: z.infer<(typeof templateSchemas)[K]> };
