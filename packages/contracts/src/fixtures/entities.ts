import type * as E from "../entities";
import { audited, ids, sha256Fixture } from "./ids";

export const organizationFixture: E.Organization = {
  ...audited(ids.organization),
  code: "sci-exemple",
  name: "SCI Exemple",
  status: "active",
  defaultCurrency: "EUR",
  displayTimezone: "Europe/Paris",
};

export const appUserFixture: E.AppUser = {
  ...audited(ids.user),
  email: "gerant@sci-exemple.test",
  fullName: "Dominique Lefèvre",
  status: "active",
  mfaEnrolledAt: "2026-01-16T10:00:00+01:00",
  lastLoginAt: "2026-02-03T08:12:00+01:00",
};

export const membershipFixture: E.Membership = {
  ...audited(ids.membership),
  appUserId: ids.user,
  role: "owner_admin",
  status: "active",
  scopeNote: null,
  startsOn: "2026-01-15",
  endsOn: null,
};

export const legalEntityFixture: E.LegalEntity = {
  ...audited(ids.legalEntity),
  name: "SCI Exemple",
  legalForm: "sci",
  siren: "123456789",
  incomeTaxRegime: "ir",
  vatStatus: "to_qualify",
  fiscalQualificationValidatedOn: null,
  eInvoicingChannel: "to_qualify",
  fiscalYearEndMonth: 12,
  fiscalYearEndDay: 31,
  odooCompanyId: 1,
  currency: "EUR",
  status: "active",
};

export const createLegalEntityInputFixture: E.CreateLegalEntityInput = {
  name: "SCI Exemple",
  legalForm: "sci",
  siren: "123456789",
};

export const updateLegalEntityInputFixture: E.UpdateLegalEntityInput = {
  id: ids.legalEntity,
  expectedVersion: 1,
  vatStatus: "not_subject",
};

export const bankAccountFixture: E.BankAccount = {
  ...audited(ids.bankAccount),
  legalEntityId: ids.legalEntity,
  label: "Compte courant SCI",
  bankName: "Banque Exemple",
  ibanLast4: "4242",
  bic: "EXAMPLFRPP",
  purpose: "operating",
  currency: "EUR",
  openingBalance: "12500.00",
  openingBalanceOn: "2026-01-01",
  feedSource: "odoo_bank_sync",
  feedLastSuccessAt: "2026-02-03T06:00:00+01:00",
  status: "active",
};

export const buildingFixture: E.Building = {
  ...audited(ids.building),
  legalEntityId: ids.legalEntity,
  code: "LILAS",
  name: "Résidence des Lilas",
  addressLine1: "12 rue des Lilas",
  addressLine2: null,
  postalCode: "64000",
  city: "Pau",
  countryCode: "FR",
  cadastralRef: "AB-0142",
  acquiredOn: "2021-06-30",
  soldOn: null,
  status: "active",
};

export const createBuildingInputFixture: E.CreateBuildingInput = {
  legalEntityId: ids.legalEntity,
  code: "LILAS",
  name: "Résidence des Lilas",
  addressLine1: "12 rue des Lilas",
  postalCode: "64000",
  city: "Pau",
};

export const updateBuildingInputFixture: E.UpdateBuildingInput = {
  id: ids.building,
  expectedVersion: 1,
  city: "Pau",
};

export const unitFixture: E.Unit = {
  ...audited(ids.unit),
  buildingId: ids.building,
  code: "A12",
  label: "Appartement T2 — 1er étage",
  kind: "dwelling",
  floor: "1",
  roomCount: 2,
  livingAreaSqm: "48.50",
  ownershipShare: "1",
  energyClass: "D",
  energyAuditOn: "2024-05-12",
  energyClassValidUntil: "2034-05-12",
  acquiredOn: "2021-06-30",
  disposedOn: null,
  status: "active",
};

export const createUnitInputFixture: E.CreateUnitInput = {
  buildingId: ids.building,
  code: "A12",
  label: "Appartement T2 — 1er étage",
  kind: "dwelling",
  roomCount: 2,
  livingAreaSqm: "48.50",
};

export const updateUnitInputFixture: E.UpdateUnitInput = {
  id: ids.unit,
  expectedVersion: 1,
  energyClass: "C",
};

export const unitUsagePeriodFixture: E.UnitUsagePeriod = {
  ...audited(ids.unitUsagePeriod),
  unitId: ids.unit,
  usage: "bare_rental",
  startsOn: "2026-01-01",
  endsOn: null,
  note: null,
};

export const personFixture: E.Person = {
  ...audited(ids.person),
  kind: "natural",
  displayName: "Camille Martin",
  firstName: "Camille",
  lastName: "Martin",
  companyName: null,
  birthDate: "1991-04-18",
  odooPartnerId: 42,
  pseudonymizedAt: null,
  retentionHold: false,
  status: "active",
};

export const contactPointFixture: E.ContactPoint = {
  ...audited(ids.contactPoint),
  personId: ids.person,
  kind: "email",
  value: "camille.martin@exemple.test",
  label: "Personnel",
  isPrimary: true,
  verifiedAt: "2026-01-20T11:00:00+01:00",
  verificationMethod: "double_opt_in",
  consentElectronicDelivery: true,
  consentRecordedAt: "2026-01-20T11:00:00+01:00",
  validFrom: "2026-01-20",
  validUntil: null,
  status: "active",
};

export const createPersonInputFixture: E.CreatePersonInput = {
  kind: "natural",
  displayName: "Camille Martin",
  firstName: "Camille",
  lastName: "Martin",
  contactPoints: [{ kind: "email", value: "camille.martin@exemple.test", isPrimary: true }],
};

export const updatePersonInputFixture: E.UpdatePersonInput = {
  id: ids.person,
  expectedVersion: 1,
  displayName: "Camille Martin",
};

export const leasePartyFixture: E.LeaseParty = {
  ...audited(ids.leaseParty),
  leaseId: ids.lease,
  personId: ids.person,
  role: "holder",
  startsOn: "2026-02-01",
  endsOn: null,
  isBillingContact: true,
};

export const leaseUnitFixture: E.LeaseUnit = {
  ...audited(ids.leaseUnit),
  leaseId: ids.lease,
  unitId: ids.unit,
  role: "main",
  startsOn: "2026-02-01",
  endsOn: null,
};

export const leaseFixture: E.Lease = {
  ...audited(ids.lease),
  legalEntityId: ids.legalEntity,
  reference: "BAIL-2026-001",
  kind: "bare",
  status: "active",
  signedOn: "2026-01-25",
  startsOn: "2026-02-01",
  endsOn: null,
  durationMonths: 36,
  rentExclCharges: "780.00",
  chargeRegime: "provision",
  chargeAmount: "120.00",
  currency: "EUR",
  depositAmount: "780.00",
  paymentDay: 5,
  paymentInAdvance: true,
  termPeriodicity: "monthly",
  prorationRule: "calendar_days",
  revisionIndex: "irl",
  revisionReferenceQuarter: "2025-T4",
  revisionMonth: 2,
  solidarity: false,
  noticeReceivedOn: null,
  noticeAnnouncedEndOn: null,
  noticeLegallyEstablished: false,
  keysReturnedOn: null,
  parties: [leasePartyFixture],
  units: [leaseUnitFixture],
};

export const createLeaseInputFixture: E.CreateLeaseInput = {
  legalEntityId: ids.legalEntity,
  reference: "BAIL-2026-001",
  kind: "bare",
  startsOn: "2026-02-01",
  durationMonths: 36,
  rentExclCharges: "780.00",
  chargeRegime: "provision",
  chargeAmount: "120.00",
  depositAmount: "780.00",
  paymentDay: 5,
  parties: [
    { personId: ids.person, role: "holder", startsOn: "2026-02-01", isBillingContact: true },
  ],
  units: [{ unitId: ids.unit, role: "main", startsOn: "2026-02-01" }],
};

export const updateLeaseInputFixture: E.UpdateLeaseInput = {
  id: ids.lease,
  expectedVersion: 1,
  status: "active",
};

export const rentTermVersionFixture: E.RentTermVersion = {
  ...audited(ids.rentTermVersion),
  rentTermId: ids.rentTerm,
  sequence: 1,
  rentAmount: "780.00",
  chargeAmount: "120.00",
  accessoryAmount: "0.00",
  totalAmount: "900.00",
  currency: "EUR",
  prorationFactor: "1",
  ruleVersionId: ids.ruleVersion,
  reason: "initial",
  isPosted: true,
  odooMoveName: "FAC/2026/0031",
  odooReadAt: "2026-02-05T07:00:00+01:00",
};

export const rentTermFixture: E.RentTerm = {
  ...audited(ids.rentTerm),
  leaseId: ids.lease,
  kind: "rent",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  dueOn: "2026-03-05",
  status: "posted",
  currentVersion: rentTermVersionFixture,
  postedAt: "2026-03-01T06:10:00+01:00",
  settledAt: null,
  adjustsRentTermId: null,
};

export const paymentAllocationFixture: E.PaymentAllocation = {
  ...audited(ids.paymentAllocation),
  paymentId: ids.payment,
  rentTermId: ids.rentTerm,
  depositAccountId: null,
  amount: "900.00",
  currency: "EUR",
  allocatedOn: "2026-03-04",
  confirmedByOdoo: true,
  odooReconcileRef: "REC/2026/0114",
  odooReadAt: "2026-03-05T07:00:00+01:00",
  reversedAt: null,
  reversalReason: null,
};

export const paymentFixture: E.Payment = {
  ...audited(ids.payment),
  legalEntityId: ids.legalEntity,
  direction: "inbound",
  amount: "900.00",
  currency: "EUR",
  receivedOn: "2026-03-04",
  valueOn: "2026-03-04",
  method: "transfer",
  payerPersonId: ids.person,
  payerLabel: "VIR CAMILLE MARTIN",
  bankTransactionId: ids.bankTransaction,
  status: "allocated",
  odooReadAt: "2026-03-05T07:00:00+01:00",
  allocations: [paymentAllocationFixture],
};

export const depositMovementFixture: E.DepositMovement = {
  ...audited(ids.depositMovement),
  depositAccountId: ids.depositAccount,
  kind: "received",
  amount: "780.00",
  currency: "EUR",
  occurredOn: "2026-02-01",
  paymentId: ids.payment,
  offsetRentTermId: null,
  justificationDocumentId: null,
  approvalId: null,
};

export const depositAccountFixture: E.DepositAccount = {
  ...audited(ids.depositAccount),
  leaseId: ids.lease,
  contractualAmount: "780.00",
  currency: "EUR",
  restitutionDueOn: null,
  status: "open",
  balanceAmount: "780.00",
  movements: [depositMovementFixture],
};

export const rentReceiptFixture: E.RentReceipt = {
  ...audited(ids.rentReceipt),
  leaseId: ids.lease,
  kind: "quittance",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  rentAmount: "780.00",
  chargeAmount: "120.00",
  totalAmount: "900.00",
  currency: "EUR",
  issuedOn: "2026-03-06",
  documentId: ids.document,
  deliveryChannel: "electronic",
  status: "delivered",
  flaggedReason: null,
};

export const supplierFixture: E.Supplier = {
  ...audited(ids.supplier),
  name: "Plomberie Exemple SARL",
  trade: "Plomberie",
  siren: "987654321",
  personId: null,
  paymentIbanLast4: "7788",
  paymentIdentityValidatedAt: "2026-01-30T15:00:00+01:00",
  status: "active",
};

export const expenseAllocationFixture: E.ExpenseAllocation = {
  ...audited(ids.expenseAllocation),
  expenseLineId: ids.expenseLine,
  target: "unit",
  unitId: ids.unit,
  buildingId: null,
  legalEntityId: null,
  amount: "384.00",
  currency: "EUR",
  recoverableAmount: "0.00",
  keyVersionId: null,
  ruleVersionId: null,
  aiExtractionId: ids.aiExtraction,
};

export const expenseLineFixture: E.ExpenseLine = {
  ...audited(ids.expenseLine),
  expenseId: ids.expense,
  lineNumber: 1,
  description: "Remplacement mitigeur cuisine",
  quantity: "1.0000",
  amountExclTax: "320.00",
  taxAmount: "64.00",
  amountInclTax: "384.00",
  currency: "EUR",
  chargeNature: "reparation",
  recoverableShare: "0",
  servicePeriodStart: null,
  servicePeriodEnd: null,
  unallocatedAmount: "0.00",
  allocations: [expenseAllocationFixture],
};

export const expenseFixture: E.Expense = {
  ...audited(ids.expense),
  legalEntityId: ids.legalEntity,
  supplierId: ids.supplier,
  worksProjectId: null,
  interventionId: ids.intervention,
  documentKind: "invoice",
  supplierReference: "F2026-0451",
  issuedOn: "2026-02-20",
  totalExclTax: "320.00",
  taxAmount: "64.00",
  totalInclTax: "384.00",
  currency: "EUR",
  payer: "entity",
  paidByPersonId: null,
  duplicateOfExpenseId: null,
  creditNoteOfExpenseId: null,
  status: "validated",
  odooMoveName: null,
  odooReadAt: null,
  lines: [expenseLineFixture],
};

export const captureExpenseInputFixture: E.CaptureExpenseInput = {
  legalEntityId: ids.legalEntity,
  documentKind: "invoice",
  totalInclTax: "384.00",
  totalExclTax: "320.00",
  taxAmount: "64.00",
  issuedOn: "2026-02-20",
  supplierId: ids.supplier,
  supplierReference: "F2026-0451",
  documentId: ids.document,
};

export const updateExpenseInputFixture: E.UpdateExpenseInput = {
  id: ids.expense,
  expectedVersion: 1,
  status: "validated",
};

export const worksProjectFixture: E.WorksProject = {
  ...audited(ids.worksProject),
  legalEntityId: ids.legalEntity,
  buildingId: ids.building,
  unitId: null,
  label: "Réfection cage d'escalier",
  nature: "improvement",
  accountingTreatment: "to_qualify",
  budgetAmount: "8500.00",
  currency: "EUR",
  startsOn: "2026-04-01",
  endsOn: null,
  status: "planned",
};

export const interventionFixture: E.Intervention = {
  ...audited(ids.intervention),
  worksProjectId: null,
  buildingId: ids.building,
  unitId: ids.unit,
  equipmentId: ids.equipment,
  leaseId: ids.lease,
  claimId: null,
  title: "Fuite mitigeur cuisine",
  description: "Signalée par la locataire le 18/02.",
  urgency: "high",
  status: "done",
  performedBy: "supplier",
  supplierId: ids.supplier,
  reportedOn: "2026-02-18",
  scheduledOn: "2026-02-19",
  completedOn: "2026-02-20",
  ownerHours: null,
  observedResult: "Mitigeur remplacé, aucune trace d'humidité résiduelle.",
  nextCheckOn: "2026-08-20",
};

export const createInterventionInputFixture: E.CreateInterventionInput = {
  title: "Fuite mitigeur cuisine",
  description: "Signalée par la locataire le 18/02.",
  urgency: "high",
  unitId: ids.unit,
  leaseId: ids.lease,
  reportedOn: "2026-02-18",
};

export const updateInterventionInputFixture: E.UpdateInterventionInput = {
  id: ids.intervention,
  expectedVersion: 1,
  status: "done",
  completedOn: "2026-02-20",
  observedResult: "Mitigeur remplacé, aucune trace d'humidité résiduelle.",
};

export const equipmentFixture: E.Equipment = {
  ...audited(ids.equipment),
  category: "plomberie",
  label: "Mitigeur cuisine",
  brand: "Exemple",
  model: "MX-200",
  serialNumber: "SN-00421",
  qrCode: null,
  purchasedOn: "2026-02-20",
  commissionedOn: "2026-02-20",
  documentedCost: "320.00",
  currency: "EUR",
  warrantyUntil: "2028-02-20",
  supplierId: ids.supplier,
  fixedAssetId: null,
  status: "in_service",
};

export const meterFixture: E.Meter = {
  ...audited(ids.meter),
  buildingId: ids.building,
  fluid: "water_cold",
  scope: "individual",
  unitOfMeasure: "m3",
  multiplier: "1",
  serialNumber: "CPT-9981",
  prmPdl: null,
  pce: null,
  locationNote: "Placard technique palier 1",
  replacedMeterId: null,
  installedOn: "2021-07-01",
  removedOn: null,
  status: "active",
};

export const meterReadingFixture: E.MeterReading = {
  ...audited(ids.meterReading),
  meterId: ids.meter,
  indexValue: "142.6000",
  readOn: "2026-03-01",
  origin: "owner",
  inspectionId: null,
  photoDocumentId: ids.document,
  isAfterReset: false,
  validatedAt: "2026-03-01T18:00:00+01:00",
  exceptionReason: null,
  status: "validated",
};

export const createMeterReadingInputFixture: E.CreateMeterReadingInput = {
  meterId: ids.meter,
  indexValue: "142.6000",
  readOn: "2026-03-01",
  origin: "owner",
  photoDocumentId: ids.document,
};

export const loanInstallmentFixture: E.LoanInstallment = {
  ...audited(ids.loanInstallment),
  scheduleVersionId: ids.loanScheduleVersion,
  installmentNumber: 57,
  dueOn: "2026-03-10",
  principalAmount: "512.34",
  interestAmount: "148.21",
  insuranceAmount: "24.50",
  feesAmount: "0.00",
  totalAmount: "685.05",
  remainingPrincipal: "98450.12",
  currency: "EUR",
  bankTransactionId: ids.bankTransaction,
  matchedAt: "2026-03-11T07:00:00+01:00",
  varianceReason: null,
  status: "matched",
};

export const loanFixture: E.Loan = {
  ...audited(ids.loan),
  legalEntityId: ids.legalEntity,
  lenderName: "Banque Exemple",
  reference: "PRET-2021-114",
  principalAmount: "150000.00",
  currency: "EUR",
  releasedOn: "2021-06-30",
  durationMonths: 240,
  rateKind: "fixed",
  nominalRate: "1.450000",
  insuranceRate: "0.240000",
  deferralMonths: 0,
  upfrontFees: "900.00",
  bankAccountId: ids.bankAccount,
  odooOutstandingPrincipal: "98450.12",
  odooReadAt: "2026-03-01T07:00:00+01:00",
  status: "active",
};

export const createLoanInputFixture: E.CreateLoanInput = {
  legalEntityId: ids.legalEntity,
  lenderName: "Banque Exemple",
  reference: "PRET-2021-114",
  principalAmount: "150000.00",
  releasedOn: "2021-06-30",
  durationMonths: 240,
  nominalRate: "1.450000",
};

export const updateLoanInputFixture: E.UpdateLoanInput = {
  id: ids.loan,
  expectedVersion: 1,
  status: "active",
};

export const ccaMovementFixture: E.CcaMovement = {
  ...audited(ids.ccaMovement),
  ccaId: ids.cca,
  kind: "expense_paid_personally",
  amount: "384.00",
  currency: "EUR",
  occurredOn: "2026-02-20",
  expenseId: ids.expense,
  paymentId: null,
  bankTransactionId: null,
  approvalId: ids.approval,
  status: "validated",
  odooReadAt: null,
};

export const createCcaMovementInputFixture: E.CreateCcaMovementInput = {
  ccaId: ids.cca,
  kind: "expense_paid_personally",
  amount: "384.00",
  occurredOn: "2026-02-20",
  expenseId: ids.expense,
  justification: "Facture plomberie réglée par l'associé.",
};

export const partnerCurrentAccountFixture: E.PartnerCurrentAccount = {
  ...audited(ids.cca),
  legalEntityId: ids.legalEntity,
  partnerPersonId: ids.person,
  agreementDocumentId: null,
  interestRate: null,
  conditions: null,
  currency: "EUR",
  odooBalance: "14320.00",
  odooReadAt: "2026-03-01T07:00:00+01:00",
  projectedBalance: "14704.00",
  status: "active",
};

export const fixedAssetFixture: E.FixedAsset = {
  ...audited(ids.fixedAsset),
  legalEntityId: ids.legalEntity,
  buildingId: ids.building,
  unitId: null,
  label: "Immeuble Résidence des Lilas",
  grossValue: "240000.00",
  landValue: "48000.00",
  currency: "EUR",
  commissionedOn: "2021-07-01",
  durationYears: "30.000000",
  method: "linear",
  accumulatedDepreciation: "30400.00",
  netBookValue: "209600.00",
  disposedOn: null,
  odooReadAt: "2026-03-01T07:00:00+01:00",
  status: "running",
};

export const documentVersionFixture: E.DocumentVersion = {
  ...audited(ids.documentVersion),
  documentId: ids.document,
  sequence: 1,
  role: "original",
  storageKey: "org/0199a000/doc/0199a000-0000-7000-8000-0000000000d0/1",
  contentType: "application/pdf",
  byteSize: 184320,
  sha256: sha256Fixture,
  detectedType: "application/pdf",
  virusScanStatus: "skipped",
  capturedAt: "2026-02-20T16:40:00+01:00",
  receivedAt: "2026-02-20T16:41:00+01:00",
  metadataMissing: false,
  derivedFromVersionId: null,
};

export const documentFixture: E.DocumentEntity = {
  ...audited(ids.document),
  title: "Facture plomberie F2026-0451",
  nature: "facture_fournisseur",
  confidentiality: "internal",
  periodStart: null,
  periodEnd: null,
  retentionClass: "comptable_10_ans",
  retentionUntil: "2036-12-31",
  legalHold: false,
  status: "active",
  currentVersion: documentVersionFixture,
  links: [{ relation: "invoice", object: { kind: "expense", id: ids.expense } }],
};

export const createDocumentMetadataInputFixture: E.CreateDocumentMetadataInput = {
  title: "Facture plomberie F2026-0451",
  nature: "facture_fournisseur",
  confidentiality: "internal",
  links: [{ relation: "invoice", object: { kind: "expense", id: ids.expense } }],
};

export const updateDocumentMetadataInputFixture: E.UpdateDocumentMetadataInput = {
  id: ids.document,
  expectedVersion: 1,
  title: "Facture plomberie F2026-0451",
};

export const activityFixture: E.Activity = {
  ...audited(ids.activity),
  channel: "email",
  direction: "inbound",
  subject: "Fuite sous l'évier",
  bodyRaw: "Bonjour, il y a une fuite sous l'évier depuis ce matin. Camille Martin",
  declaredAuthor: "camille.martin@exemple.test",
  authorPersonId: ids.person,
  authorUserId: null,
  externalId: "msg-18f2c",
  capturedAt: "2026-02-18T08:05:00+01:00",
  receivedAt: "2026-02-18T08:06:00+01:00",
  occurredAt: "2026-02-18T08:05:00+01:00",
  objects: [{ kind: "lease", id: ids.lease }],
};

export const eventFixture: E.EventEntity = {
  ...audited(ids.event),
  type: "rent_term.posted",
  primaryObject: { kind: "rent_term", id: ids.rentTerm },
  effectiveOn: "2026-03-01",
  occurredAt: "2026-03-01T06:10:00+01:00",
  recordedAt: "2026-03-01T06:10:01+01:00",
  origin: "saas",
  actorUserId: null,
  actorLabel: "worker:rent-preparation",
  sourceActivityId: null,
  payload: { totalAmount: "900.00", currency: "EUR" },
  objects: [{ kind: "lease", id: ids.lease }],
};

export const deadlineFixture: E.Deadline = {
  ...audited(ids.deadline),
  type: "lease.revision",
  title: "Réviser le loyer (IRL) du bail BAIL-2026-001",
  dueOn: "2027-02-01",
  originalDueOn: "2027-02-01",
  remindFromOn: "2027-01-02",
  priority: "normal",
  assigneeUserId: ids.user,
  ruleVersionId: ids.ruleVersion,
  recurrenceRule: "FREQ=YEARLY",
  recurrenceAnchor: "contract_date",
  parentDeadlineId: null,
  status: "planned",
  postponedReason: null,
  cancelledReason: null,
  completedEventId: null,
  completedAt: null,
  objects: [{ kind: "lease", id: ids.lease }],
};

export const inboxItemFixture: E.InboxItem = {
  ...audited(ids.inboxItem),
  activityId: ids.activity,
  documentId: ids.document,
  source: "email_forward",
  sourceReference: "msg-18f2c",
  proposedObject: { kind: "expense", id: ids.expense },
  proposedAction: "Rattacher la facture à la dépense F2026-0451",
  uncertaintyReason: null,
  status: "analyzed",
  rejectedReason: null,
  duplicateOfInboxItemId: null,
  processedAt: null,
};

export const inboxDecisionInputFixture: E.InboxDecisionInput = {
  id: ids.inboxItem,
  expectedVersion: 1,
  decision: "attach",
  attachTo: { kind: "expense", id: ids.expense },
};

export const inboxIntentFixture: E.InboxIntent = {
  proposedObject: { kind: "expense", id: ids.expense },
  proposedAction: "Rattacher la facture à la dépense F2026-0451",
  documentKindGuess: "facture_fournisseur",
  uncertaintyReason: null,
  confidence: 0.92,
};

export const insurancePolicyFixture: E.InsurancePolicy = {
  ...audited(ids.insurancePolicy),
  legalEntityId: ids.legalEntity,
  kind: "pno",
  insurerName: "Assureur Exemple",
  policyNumber: "PNO-88421",
  insuredPersonId: null,
  startsOn: "2025-09-01",
  endsOn: "2026-08-31",
  premiumAmount: "312.00",
  premiumPeriodicity: "yearly",
  deductibleAmount: "150.00",
  currency: "EUR",
  guaranteesSummary: "Dégâts des eaux, incendie, responsabilité civile.",
  exclusionsSummary: null,
  contractDocumentId: ids.document,
  lastCertificateCheckedAt: "2025-09-05T10:00:00+02:00",
  status: "active",
};

export const claimFixture: E.Claim = {
  ...audited(ids.claim),
  policyId: ids.insurancePolicy,
  buildingId: ids.building,
  unitId: ids.unit,
  leaseId: ids.lease,
  reference: "SIN-2026-002",
  insurerClaimNumber: null,
  occurredOn: "2026-02-18",
  declaredOn: "2026-02-19",
  facts: "Fuite sous évier, dégât sur le meuble bas.",
  allegedLiability: "Vétusté du mitigeur",
  acknowledgedLiability: null,
  expertName: null,
  expertVisitOn: null,
  estimatedDamage: "450.00",
  indemnityExpected: "300.00",
  indemnityReceived: null,
  deductibleApplied: null,
  currency: "EUR",
  deadlineOn: "2026-03-21",
  status: "declared",
};

export const bookingFixture: E.Booking = {
  ...audited(ids.booking),
  listingId: ids.listing,
  unitId: ids.unit,
  platform: "airbnb",
  externalBookingId: "HMABCDEF12",
  guestPersonId: null,
  guestCount: 2,
  checkInOn: "2026-07-10",
  checkOutOn: "2026-07-17",
  nights: 7,
  accommodationAmount: "735.00",
  cleaningAmount: "60.00",
  commissionAmount: "23.85",
  refundAmount: "0.00",
  touristTaxCollected: "14.70",
  touristTaxRemitted: "0.00",
  depositAmount: "0.00",
  currency: "EUR",
  status: "confirmed",
  source: "ical",
};

export const payoutFixture: E.Payout = {
  ...audited(ids.payout),
  legalEntityId: ids.legalEntity,
  platform: "airbnb",
  externalPayoutId: "PO-2026-07-19",
  paidOn: "2026-07-19",
  netAmount: "771.15",
  currency: "EUR",
  bankTransactionId: ids.bankTransaction,
  status: "matched",
  varianceAmount: "0.00",
};

export const ruleVersionFixture: E.RuleVersionEntity = {
  ...audited(ids.ruleVersion),
  ruleId: ids.rule,
  sequence: 1,
  definition: { index: "irl", rounding: "half_up", decimals: 2 },
  definitionHash: sha256Fixture,
  scope: { legalEntityId: ids.legalEntity },
  examples: [{ baseRent: "780.00", proposedRent: "795.60" }],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  approvedBy: ids.user,
  approvedAt: "2026-01-10T09:00:00+01:00",
  status: "active",
};

export const ruleFixture: E.Rule = {
  ...audited(ids.rule),
  code: "rent-policy-validated",
  domain: "rent_indexation",
  label: "Révision IRL annuelle",
  origin: "manual",
  status: "active",
  suspendedReason: null,
  correctionCount: 0,
  applicationCount: 3,
  currentVersion: ruleVersionFixture,
};

export const commandAttemptFixture: E.CommandAttempt = {
  ...audited(ids.commandAttempt),
  commandId: ids.command,
  attemptNumber: 1,
  step: "create_draft_move",
  startedAt: "2026-03-01T06:10:05+01:00",
  finishedAt: "2026-03-01T06:10:07+01:00",
  outcome: "success",
  httpStatus: 200,
  providerFault: null,
  responseExcerpt: null,
  workerId: "worker-1",
};

export const commandFixture: E.Command = {
  ...audited(ids.command),
  commandType: "prepare_rent_accounting",
  operationKey: ids.operation,
  payload: { rentTermId: ids.rentTerm, totalAmount: "900.00" },
  payloadHash: sha256Fixture,
  targetObject: { kind: "rent_term", id: ids.rentTerm },
  expectedVersion: 1,
  ruleVersionId: ids.ruleVersion,
  approvalId: ids.approval,
  actorUserId: ids.user,
  autonomyLevel: "C",
  status: "confirmed",
  errorType: null,
  errorDetail: null,
  correlationId: ids.request,
  attempts: [commandAttemptFixture],
};

export const aiExtractionFixture: E.AiExtraction = {
  ...audited(ids.aiExtraction),
  subjectObject: { kind: "expense", id: ids.expense },
  sourceDocumentVersionId: ids.documentVersion,
  sourceActivityId: null,
  inboxItemId: ids.inboxItem,
  fieldPath: "expense.total_incl_tax",
  proposedValue: "384.00",
  confidence: "0.970000",
  evidenceExcerpt: "Total TTC 384,00 €",
  evidencePage: 1,
  provider: "anthropic",
  modelName: "claude-opus-5",
  modelVersion: null,
  promptVersion: "extract-invoice-v3",
  decision: "accepted",
  decidedValue: "384.00",
  decidedAt: "2026-02-21T09:15:00+01:00",
  autonomyLevel: "A",
};

export const integrationHealthFixture: E.IntegrationHealth = {
  connector: "odoo",
  stream: "account.move",
  health: "healthy",
  lastSuccessAt: "2026-03-05T07:00:00+01:00",
  lastAttemptAt: "2026-03-05T07:00:00+01:00",
  lastError: null,
  consecutiveFailures: 0,
  pendingCommands: 0,
  lagSeconds: 42,
};
