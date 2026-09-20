import {
  ContactPointKind,
  ContactPointStatus,
  CreatePersonInput,
  Currency,
  Cursor,
  DepositAccountStatus,
  DepositMovementKind,
  IsoDate,
  IsoDateTime,
  LeaseChargeRegime,
  LeaseKind,
  LeasePartyRole,
  LeaseRevisionIndex,
  LeaseStatus,
  LeaseUnitRole,
  Money,
  Page,
  PaymentMethod,
  PaymentStatus,
  PersonKind,
  PersonStatus,
  RentReceiptKind,
  RentReceiptStatus,
  RentTermKind,
  RentTermStatus,
  UpdatePersonInput,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: Cursor.nullable() });

const listInput = <T extends z.ZodRawShape>(filters: T) =>
  z.strictObject({ ...Page.shape, ...filters });

/** BAI-01: what the engine checks before a lease may be activated. */
export const MissingPiece = z.enum(["party", "unit", "dates", "rent", "deposit"]);
export type MissingPiece = z.infer<typeof MissingPiece>;

export const Settlement = z.enum(["unpaid", "partial", "paid"]);
export type Settlement = z.infer<typeof Settlement>;

/** LOY-03: `recu` for a partial payment, `quittance` once rent and charges are settled. */
export const ReceiptKind = z.enum(["quittance", "recu"]);
export type ReceiptKind = z.infer<typeof ReceiptKind>;

export const ContactPointRead = z.object({
  id: Uuid,
  kind: ContactPointKind,
  value: z.string(),
  label: z.string().nullable(),
  isPrimary: z.boolean(),
  status: ContactPointStatus,
});
export type ContactPointRead = z.infer<typeof ContactPointRead>;

export const LeaseListItem = z.object({
  id: Uuid,
  reference: z.string(),
  kind: LeaseKind,
  status: LeaseStatus,
  startsOn: IsoDate.nullable(),
  endsOn: IsoDate.nullable(),
  rentExclCharges: Money.nullable(),
  chargeAmount: Money.nullable(),
  currency: Currency,
  unitLabel: z.string().nullable(),
  buildingName: z.string().nullable(),
  tenants: z.array(z.string()),
  nextDueOn: IsoDate.nullable(),
  arrears: Money,
  version: Version,
});
export type LeaseListItem = z.infer<typeof LeaseListItem>;

export const LeasePartyRead = z.object({
  id: Uuid,
  personId: Uuid,
  personName: z.string(),
  role: LeasePartyRole,
  startsOn: IsoDate,
  endsOn: IsoDate.nullable(),
  isBillingContact: z.boolean(),
});
export type LeasePartyRead = z.infer<typeof LeasePartyRead>;

export const LeaseUnitRead = z.object({
  id: Uuid,
  unitId: Uuid,
  unitLabel: z.string(),
  buildingName: z.string(),
  role: LeaseUnitRole,
  startsOn: IsoDate,
  endsOn: IsoDate.nullable(),
});
export type LeaseUnitRead = z.infer<typeof LeaseUnitRead>;

export const LeaseDetail = LeaseListItem.extend({
  legalEntityId: Uuid,
  signedOn: IsoDate.nullable(),
  durationMonths: z.number().int().nullable(),
  chargeRegime: LeaseChargeRegime,
  depositAmount: Money.nullable(),
  depositBalance: Money.nullable(),
  paymentDay: z.number().int().nullable(),
  paymentInAdvance: z.boolean(),
  revisionIndex: LeaseRevisionIndex.nullable(),
  revisionReferenceQuarter: z.string().nullable(),
  revisionMonth: z.number().int().nullable(),
  solidarity: z.boolean(),
  noticeReceivedOn: IsoDate.nullable(),
  noticeAnnouncedEndOn: IsoDate.nullable(),
  noticeLegallyEstablished: z.boolean(),
  keysReturnedOn: IsoDate.nullable(),
  parties: z.array(LeasePartyRead),
  units: z.array(LeaseUnitRead),
  missingPieces: z.array(MissingPiece),
  allowedTransitions: z.array(LeaseStatus),
  createdAt: IsoDateTime,
});
export type LeaseDetail = z.infer<typeof LeaseDetail>;

export const RentTermRead = z.object({
  id: Uuid,
  leaseId: Uuid,
  kind: RentTermKind,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  dueOn: IsoDate,
  status: RentTermStatus,
  rentAmount: Money,
  chargeAmount: Money,
  totalAmount: Money,
  currency: Currency,
  paidAmount: Money,
  outstanding: Money,
  settlement: Settlement,
  receipt: ReceiptKind,
  receiptIssued: z.boolean(),
  version: Version,
});
export type RentTermRead = z.infer<typeof RentTermRead>;

export const PaymentAllocationRead = z.object({
  id: Uuid,
  rentTermId: Uuid.nullable(),
  periodStart: IsoDate.nullable(),
  amount: Money,
  allocatedOn: IsoDate,
});
export type PaymentAllocationRead = z.infer<typeof PaymentAllocationRead>;

export const PaymentRead = z.object({
  id: Uuid,
  amount: Money,
  currency: Currency,
  receivedOn: IsoDate,
  method: PaymentMethod.nullable(),
  payerPersonId: Uuid.nullable(),
  payerLabel: z.string().nullable(),
  status: PaymentStatus,
  allocatedAmount: Money,
  unallocatedAmount: Money,
  allocations: z.array(PaymentAllocationRead),
  version: Version,
});
export type PaymentRead = z.infer<typeof PaymentRead>;

export const DepositMovementRead = z.object({
  id: Uuid,
  kind: DepositMovementKind,
  amount: Money,
  occurredOn: IsoDate,
});
export type DepositMovementRead = z.infer<typeof DepositMovementRead>;

export const DepositRead = z.object({
  leaseId: Uuid,
  accountId: Uuid.nullable(),
  contractualAmount: Money.nullable(),
  balanceAmount: Money,
  status: DepositAccountStatus.nullable(),
  restitutionDueOn: IsoDate.nullable(),
  movements: z.array(DepositMovementRead),
  version: Version.nullable(),
});
export type DepositRead = z.infer<typeof DepositRead>;

export const ReceiptRead = z.object({
  id: Uuid,
  leaseId: Uuid,
  kind: RentReceiptKind,
  periodStart: IsoDate,
  periodEnd: IsoDate,
  rentAmount: Money,
  chargeAmount: Money,
  totalAmount: Money,
  currency: Currency,
  issuedOn: IsoDate,
  status: RentReceiptStatus,
  commandId: Uuid.nullable(),
});
export type ReceiptRead = z.infer<typeof ReceiptRead>;

const IndexValueRead = z.object({
  value: z.string(),
  quarter: z.number().int().min(1).max(4),
  year: z.number().int(),
});

/** IRL-01: a missing input blocks the proposal instead of producing a rent. */
export const RevisionProposalRead = z.object({
  available: z.boolean(),
  blockedReason: z.string().nullable(),
  missing: z.array(z.string()),
  currentRent: Money.nullable(),
  newRent: Money.nullable(),
  increase: Money.nullable(),
  baseIndex: IndexValueRead.nullable(),
  newIndex: IndexValueRead.nullable(),
  effectiveFrom: IsoDate.nullable(),
  prepared: z
    .object({ revisionId: Uuid, commandId: Uuid, proposedRent: Money, status: z.string() })
    .nullable(),
});
export type RevisionProposalRead = z.infer<typeof RevisionProposalRead>;

export const PersonListItem = z.object({
  id: Uuid,
  kind: PersonKind,
  displayName: z.string(),
  status: PersonStatus,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  leaseCount: z.number().int(),
  version: Version,
});
export type PersonListItem = z.infer<typeof PersonListItem>;

export const PersonDetail = PersonListItem.extend({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  companyName: z.string().nullable(),
  birthDate: IsoDate.nullable(),
  contactPoints: z.array(ContactPointRead),
  leases: z.array(LeaseListItem),
  balance: Money,
  createdAt: IsoDateTime,
});
export type PersonDetail = z.infer<typeof PersonDetail>;

const ContactPointInput = z.strictObject({
  kind: ContactPointKind,
  value: z.string().min(1),
  label: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

/** LOC-01: a party is an existing person or one created with the lease, never a free-text name. */
const LeasePartyInput = z
  .strictObject({
    personId: Uuid.optional(),
    person: CreatePersonInput.optional(),
    role: LeasePartyRole,
    startsOn: IsoDate,
    isBillingContact: z.boolean().optional(),
  })
  .refine((value) => (value.personId === undefined) !== (value.person === undefined), {
    message: "renseignez un locataire existant ou les informations d’un nouveau locataire",
  });

export const CreateLeaseFormInput = z.strictObject({
  reference: z.string().min(1),
  kind: LeaseKind,
  startsOn: IsoDate,
  endsOn: IsoDate.optional(),
  rentExclCharges: Money,
  chargeRegime: LeaseChargeRegime,
  chargeAmount: Money.optional(),
  depositAmount: Money.optional(),
  paymentDay: z.number().int().min(1).max(31),
  revisionIndex: LeaseRevisionIndex.optional(),
  revisionReferenceQuarter: z.string().optional(),
  revisionMonth: z.number().int().min(1).max(12).optional(),
  solidarity: z.boolean().optional(),
  parties: z.array(LeasePartyInput).min(1),
  units: z.array(z.strictObject({ unitId: Uuid, role: LeaseUnitRole })).min(1),
});
export type CreateLeaseFormInput = z.infer<typeof CreateLeaseFormInput>;

export const UpdateLeaseFormInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  reference: z.string().min(1).optional(),
  endsOn: IsoDate.nullable().optional(),
  rentExclCharges: Money.optional(),
  chargeRegime: LeaseChargeRegime.optional(),
  chargeAmount: Money.nullable().optional(),
  depositAmount: Money.nullable().optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
  signedOn: IsoDate.nullable().optional(),
  revisionIndex: LeaseRevisionIndex.nullable().optional(),
  revisionReferenceQuarter: z.string().nullable().optional(),
  revisionMonth: z.number().int().min(1).max(12).nullable().optional(),
  solidarity: z.boolean().optional(),
  noticeReceivedOn: IsoDate.nullable().optional(),
  noticeAnnouncedEndOn: IsoDate.nullable().optional(),
  noticeLegallyEstablished: z.boolean().optional(),
  keysReturnedOn: IsoDate.nullable().optional(),
});
export type UpdateLeaseFormInput = z.infer<typeof UpdateLeaseFormInput>;

export const GenerateTermsResult = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  terms: z.array(RentTermRead),
});
export type GenerateTermsResult = z.infer<typeof GenerateTermsResult>;

export const AllocateResult = z.object({
  payment: PaymentRead,
  terms: z.array(RentTermRead),
  overpayment: Money,
});
export type AllocateResult = z.infer<typeof AllocateResult>;

export const UnitOption = z.object({
  id: Uuid,
  label: z.string(),
  buildingName: z.string(),
  occupied: z.boolean(),
});
export type UnitOption = z.infer<typeof UnitOption>;

export const UnitOptions = z.object({ items: z.array(UnitOption) });

export const PersonPage = paginated(PersonListItem);
export const LeasePage = paginated(LeaseListItem);
export const RentTermPage = paginated(RentTermRead);
export const PaymentPage = paginated(PaymentRead);
export const ReceiptPage = paginated(ReceiptRead);

const route = (path: string, summary: string, method: "GET" | "POST" = "POST") =>
  oc.route({ method, path: `/locations${path}`, summary });

export const locationsContract = {
  locations: {
    units: {
      options: route("/lots", "Lots disponibles pour un bail", "GET")
        .input(z.strictObject({ search: z.string().optional() }))
        .output(UnitOptions),
    },
    persons: {
      list: route("/personnes", "Liste des locataires", "GET")
        .input(listInput({ search: z.string().optional(), status: PersonStatus.optional() }))
        .output(PersonPage),
      get: route("/personnes/get", "Fiche locataire")
        .input(z.strictObject({ id: Uuid }))
        .output(PersonDetail),
      create: route("/personnes/creer", "Créer un locataire")
        .input(CreatePersonInput)
        .output(PersonDetail),
      update: route("/personnes/modifier", "Modifier un locataire")
        .input(UpdatePersonInput.extend({ contactPoints: z.array(ContactPointInput).optional() }))
        .output(PersonDetail),
    },
    leases: {
      list: route("/baux", "Liste des baux", "GET")
        .input(
          listInput({
            status: LeaseStatus.optional(),
            buildingId: Uuid.optional(),
            unitId: Uuid.optional(),
            personId: Uuid.optional(),
            search: z.string().optional(),
          }),
        )
        .output(LeasePage),
      get: route("/baux/get", "Fiche bail")
        .input(z.strictObject({ id: Uuid }))
        .output(LeaseDetail),
      create: route("/baux/creer", "Créer un bail").input(CreateLeaseFormInput).output(LeaseDetail),
      update: route("/baux/modifier", "Modifier un bail")
        .input(UpdateLeaseFormInput)
        .output(LeaseDetail),
      transition: route("/baux/transition", "Changer l’état d’un bail")
        .input(z.strictObject({ id: Uuid, expectedVersion: Version, to: LeaseStatus }))
        .output(LeaseDetail),
    },
    rentTerms: {
      list: route("/termes", "Termes de loyer d’un bail", "GET")
        .input(listInput({ leaseId: Uuid, status: RentTermStatus.optional() }))
        .output(RentTermPage),
      generate: route("/termes/generer", "Générer les termes d’une période")
        .input(z.strictObject({ leaseId: Uuid, from: IsoDate, to: IsoDate }))
        .output(GenerateTermsResult),
    },
    payments: {
      list: route("/paiements", "Paiements rattachés à un bail", "GET")
        .input(listInput({ leaseId: Uuid.optional() }))
        .output(PaymentPage),
      create: route("/paiements/enregistrer", "Enregistrer un paiement")
        .input(
          z.strictObject({
            leaseId: Uuid,
            amount: Money,
            receivedOn: IsoDate,
            method: PaymentMethod.optional(),
            payerPersonId: Uuid.optional(),
            payerLabel: z.string().optional(),
          }),
        )
        .output(PaymentRead),
      allocate: route("/paiements/affecter", "Affecter un paiement à des termes")
        .input(
          z.strictObject({
            paymentId: Uuid,
            expectedVersion: Version,
            allocatedOn: IsoDate.optional(),
            allocations: z.array(z.strictObject({ rentTermId: Uuid, amount: Money })).min(1),
          }),
        )
        .output(AllocateResult),
    },
    receipts: {
      list: route("/quittances", "Quittances et reçus", "GET")
        .input(listInput({ leaseId: Uuid }))
        .output(ReceiptPage),
      issue: route("/quittances/emettre", "Émettre une quittance ou un reçu")
        .input(z.strictObject({ rentTermId: Uuid, kind: ReceiptKind.optional() }))
        .output(ReceiptRead),
    },
    deposits: {
      get: route("/depot/get", "Dépôt de garantie d’un bail")
        .input(z.strictObject({ leaseId: Uuid }))
        .output(DepositRead),
      record: route("/depot/mouvement", "Enregistrer un mouvement de dépôt")
        .input(
          z.strictObject({
            leaseId: Uuid,
            kind: DepositMovementKind,
            amount: Money,
            occurredOn: IsoDate,
          }),
        )
        .output(DepositRead),
    },
    revisions: {
      propose: route("/revision/proposer", "Proposition de révision de loyer")
        .input(z.strictObject({ leaseId: Uuid, requestDate: IsoDate.optional() }))
        .output(RevisionProposalRead),
      apply: route("/revision/preparer", "Préparer la révision (validation requise)")
        .input(z.strictObject({ leaseId: Uuid, expectedVersion: Version }))
        .output(RevisionProposalRead),
    },
  },
};
