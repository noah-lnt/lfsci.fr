export type SourceName = "odoo" | "odoo_copy" | "spreadsheet" | "platform";

export type RecordKind =
  | "person"
  | "supplier"
  | "lease"
  | "rent_term"
  | "expense"
  | "bank_line"
  | "loan"
  | "meter"
  | "asset"
  | "booking"
  | "deposit_movement"
  | "cca_movement"
  | "loan_movement";

export type RejectionReason =
  | "missing_field"
  | "invalid_date"
  | "invalid_money"
  | "invalid_value"
  | "unknown_entity"
  | "unknown_person"
  | "unknown_lease"
  | "unknown_building"
  | "duplicate_reference"
  | "not_posted"
  | "unsupported";

export type DeferralReason = "owned_by_backsync" | "use_in_app_import" | "entered_in_app";

export type Rejection = {
  source: SourceName;
  kind: RecordKind;
  ref: string;
  line?: number;
  reason: RejectionReason;
  detail: string;
};

type Base = { source: SourceName; ref: string; line?: number };

export type PersonRole = "tenant" | "supplier" | "associate" | "lender";

export type PersonRecord = Base & {
  kind: "person";
  displayName: string;
  roles: PersonRole[];
  email: string | null;
  phone: string | null;
  odooPartnerId: number | null;
};

export type SupplierRecord = Base & {
  kind: "supplier";
  name: string;
  vat: string | null;
  odooPartnerId: number | null;
};

export type LeaseRecord = Base & {
  kind: "lease";
  entity: string;
  odooCompanyId: number | null;
  reference: string;
  tenantName: string;
  unitCode: string | null;
  leaseKind: string;
  startsOn: string;
  endsOn: string | null;
  rent: string;
  charges: string;
  deposit: string | null;
  paymentDay: number | null;
  inferred: boolean;
};

export type RentTermRecord = Base & {
  kind: "rent_term";
  entity: string;
  odooCompanyId: number | null;
  partnerName: string;
  odooPartnerId: number;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  total: string;
  residual: string;
  settled: boolean;
  component: "rent" | "charges";
  odooMoveId: number;
  odooMoveName: string;
  odooStatementLineId: number | null;
  nettedRefs: string[];
};

export type ExpenseRecord = Base & {
  kind: "expense";
  entity: string;
  odooCompanyId: number | null;
  supplierName: string;
  odooPartnerId: number;
  issuedOn: string;
  totalInclTax: string;
  residual: string;
  paid: boolean;
  odooMoveId: number;
  odooMoveName: string;
};

export type BankLineRecord = Base & {
  kind: "bank_line";
  entity: string;
  odooCompanyId: number | null;
  journal: string;
  odooJournalId: number | null;
  date: string;
  amount: string;
  label: string;
};

export type LoanRecord = Base & {
  kind: "loan";
  entity: string;
  odooCompanyId: number | null;
  reference: string;
  lender: string;
  principal: string;
  releasedOn: string | null;
  durationMonths: number | null;
  nominalRate: string | null;
  outstanding: string | null;
  outstandingOn: string | null;
};

export type MeterRecord = Base & {
  kind: "meter";
  entity: string;
  buildingCode: string;
  fluid: string;
  scope: string;
  unitOfMeasure: string;
  serialNumber: string;
  prm: string | null;
  pce: string | null;
  lastIndex: string | null;
  lastReadOn: string | null;
};

export type AssetRecord = Base & {
  kind: "asset";
  entity: string;
  odooCompanyId: number | null;
  label: string;
  grossValue: string;
  accumulatedDepreciation: string;
  netBookValue: string;
  commissionedOn: string | null;
  odooAssetId: number;
};

export type BookingRecord = Base & {
  kind: "booking";
  externalBookingId: string;
  listingExternalId: string | null;
  checkInOn: string;
  checkOutOn: string;
  guestName: string | null;
  accommodationAmount: string;
  payoutNetAmount: string | null;
};

type Movement = Base & {
  entity: string;
  odooCompanyId: number | null;
  partnerName: string;
  odooPartnerId: number;
  occurredOn: string;
  amount: string;
  odooMoveId: number;
  odooMoveName: string;
  odooStatementLineId: number | null;
};

export type DepositMovementRecord = Movement & {
  kind: "deposit_movement";
  direction: "received" | "returned";
};

export type CcaMovementRecord = Movement & {
  kind: "cca_movement";
  direction: "contribution" | "repayment";
};

export type LoanMovementRecord = Movement & {
  kind: "loan_movement";
  direction: "drawdown" | "repayment" | "interest";
};

export type SourceRecord =
  | PersonRecord
  | SupplierRecord
  | LeaseRecord
  | RentTermRecord
  | ExpenseRecord
  | BankLineRecord
  | LoanRecord
  | MeterRecord
  | AssetRecord
  | BookingRecord
  | DepositMovementRecord
  | CcaMovementRecord
  | LoanMovementRecord;

export type SourceCoverage = { from: string | null; to: string | null };

export type SourceRead = {
  source: SourceName;
  label: string;
  found: number;
  records: SourceRecord[];
  rejections: Rejection[];
  notes: string[];
  coverage: SourceCoverage;
  readAt: string;
};

export interface SourceReader {
  readonly name: SourceName;
  read(): Promise<SourceRead>;
}

export class SourceUnreachable extends Error {
  constructor(
    readonly source: SourceName,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SourceUnreachable";
  }
}

export type ExistingEntity = { id: string; name: string; odooCompanyId: number | null };
export type ExistingPerson = {
  id: string;
  displayName: string;
  odooPartnerId: number | null;
  emails: string[];
};
export type ExistingSupplier = { id: string; name: string; odooPartnerId: number | null };
export type ExistingLease = {
  id: string;
  reference: string;
  legalEntityId: string;
  holderPersonIds: string[];
};
export type ExistingBuilding = { id: string; code: string; legalEntityId: string };

export type ExistingRows = {
  entities: ExistingEntity[];
  persons: ExistingPerson[];
  suppliers: ExistingSupplier[];
  leases: ExistingLease[];
  buildings: ExistingBuilding[];
};

export type MatchKind = "legal_entity" | "person" | "supplier" | "lease" | "building";
export type MatchEvidence =
  | "odoo_company_id"
  | "odoo_partner_id"
  | "email"
  | "name"
  | "reference"
  | "code"
  | "tenant";
export type Confidence = "high" | "medium";

export type Match = {
  kind: MatchKind;
  ref: string;
  label: string;
  existingId: string;
  existingLabel: string;
  evidence: MatchEvidence;
  confidence: Confidence;
};

export type Ambiguity = {
  kind: MatchKind;
  ref: string;
  label: string;
  evidence: MatchEvidence;
  candidates: { id: string; label: string }[];
};

export type Deferral = { kind: RecordKind; ref: string; reason: DeferralReason; detail: string };

export type Proposal = { kind: RecordKind; ref: string; detail: string };

export type EntityTotals = {
  entityId: string;
  entityName: string;
  counts: Partial<Record<RecordKind, number>>;
  totals: Partial<Record<RecordKind, string>>;
};

export type SourceSummary = {
  source: SourceName;
  label: string;
  found: number;
  mapped: number;
  rejected: number;
  notes: string[];
  coverage: SourceCoverage;
  readAt: string;
};

export type Target = { existingId: string } | { create: string };

export type Resolutions = {
  entities: Record<string, string>;
  persons: Record<string, Target>;
  personGroups: Record<string, PersonRecord>;
  suppliers: Record<string, Target>;
  supplierGroups: Record<string, SupplierRecord>;
  leases: Record<string, Target>;
  leaseTenants: Record<string, Target>;
  rentTermLeases: Record<string, Target>;
  buildings: Record<string, string>;
};

export type Plan = {
  generatedAt: string;
  organizationId: string;
  sources: SourceSummary[];
  records: SourceRecord[];
  rejections: Rejection[];
  matches: Match[];
  ambiguities: Ambiguity[];
  deferrals: Deferral[];
  proposals: Proposal[];
  resolutions: Resolutions;
  perEntity: EntityTotals[];
  blockers: string[];
};
