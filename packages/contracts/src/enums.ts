import { z } from "zod";

// One Zod enum per `CHECK (<col> IN (...))` of docs/schema/lfsci.sql, generated
// from that file and pinned to it by packages/contracts/tests/sql-parity.test.ts.

export const OrganizationStatus = z.enum(["active", "suspended", "closed"]);
export type OrganizationStatus = z.infer<typeof OrganizationStatus>;

export const AppUserStatus = z.enum(["invited", "active", "suspended", "disabled"]);
export type AppUserStatus = z.infer<typeof AppUserStatus>;

export const MembershipRole = z.enum([
  "owner_admin",
  "delegated_manager",
  "accountant",
  "partner_reader",
  "tenant_portal",
  "provider",
  "technical",
]);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const MembershipStatus = z.enum(["invited", "active", "revoked"]);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

export const LegalEntityLegalForm = z.enum([
  "sci",
  "sarl",
  "sas",
  "sci_familiale",
  "individual",
  "other",
]);
export type LegalEntityLegalForm = z.infer<typeof LegalEntityLegalForm>;

export const LegalEntityIncomeTaxRegime = z.enum(["is", "ir", "to_qualify"]);
export type LegalEntityIncomeTaxRegime = z.infer<typeof LegalEntityIncomeTaxRegime>;

export const LegalEntityVatStatus = z.enum([
  "not_subject",
  "exempt",
  "franchise",
  "vat_non_deductible",
  "subject",
  "to_qualify",
]);
export type LegalEntityVatStatus = z.infer<typeof LegalEntityVatStatus>;

export const LegalEntityEInvoicingChannel = z.enum(["none", "pdp", "pa", "to_qualify"]);
export type LegalEntityEInvoicingChannel = z.infer<typeof LegalEntityEInvoicingChannel>;

export const LegalEntityStatus = z.enum(["draft", "active", "dissolved", "archived"]);
export type LegalEntityStatus = z.infer<typeof LegalEntityStatus>;

export const BankAccountPurpose = z.enum(["operating", "deposit", "transit", "savings", "loan"]);
export type BankAccountPurpose = z.infer<typeof BankAccountPurpose>;

export const BankAccountFeedSource = z.enum([
  "odoo_bank_sync",
  "odoo_manual_import",
  "fallback_import",
]);
export type BankAccountFeedSource = z.infer<typeof BankAccountFeedSource>;

export const BankAccountStatus = z.enum(["active", "closed", "disconnected"]);
export type BankAccountStatus = z.infer<typeof BankAccountStatus>;

export const BankTransactionReconciliationStatus = z.enum([
  "unreconciled",
  "partially_reconciled",
  "reconciled",
  "excluded",
]);
export type BankTransactionReconciliationStatus = z.infer<
  typeof BankTransactionReconciliationStatus
>;

export const BuildingStatus = z.enum(["prospect", "active", "sold", "archived"]);
export type BuildingStatus = z.infer<typeof BuildingStatus>;

export const UnitKind = z.enum([
  "dwelling",
  "annex",
  "parking",
  "storage",
  "technical",
  "commercial",
  "common_area",
]);
export type UnitKind = z.infer<typeof UnitKind>;

export const UnitEnergyClass = z.enum(["A", "B", "C", "D", "E", "F", "G"]);
export type UnitEnergyClass = z.infer<typeof UnitEnergyClass>;

export const UnitStatus = z.enum(["draft", "active", "disposed", "archived"]);
export type UnitStatus = z.infer<typeof UnitStatus>;

export const UnitLineageOperation = z.enum(["split", "merge", "perimeter_change"]);
export type UnitLineageOperation = z.infer<typeof UnitLineageOperation>;

export const UnitUsagePeriodUsage = z.enum([
  "bare_rental",
  "furnished_rental",
  "mobility_rental",
  "tourist_rental",
  "commercial_rental",
  "owner_use",
  "vacant",
  "works",
  "common",
]);
export type UnitUsagePeriodUsage = z.infer<typeof UnitUsagePeriodUsage>;

export const UnitDiagnosticKind = z.enum([
  "dpe",
  "asbestos",
  "lead",
  "gas",
  "electricity",
  "erp",
  "noise",
  "termite",
  "other",
]);
export type UnitDiagnosticKind = z.infer<typeof UnitDiagnosticKind>;

export const UnitDiagnosticStatus = z.enum([
  "missing",
  "valid",
  "expiring",
  "expired",
  "unreadable",
]);
export type UnitDiagnosticStatus = z.infer<typeof UnitDiagnosticStatus>;

export const PersonKind = z.enum(["natural", "legal"]);
export type PersonKind = z.infer<typeof PersonKind>;

export const PersonStatus = z.enum(["active", "inactive", "pseudonymized"]);
export type PersonStatus = z.infer<typeof PersonStatus>;

export const ContactPointKind = z.enum(["email", "phone", "mobile", "postal", "other"]);
export type ContactPointKind = z.infer<typeof ContactPointKind>;

export const ContactPointStatus = z.enum(["active", "obsolete", "bounced", "revoked"]);
export type ContactPointStatus = z.infer<typeof ContactPointStatus>;

export const PersonRoleRole = z.enum([
  "tenant",
  "co_tenant",
  "occupant",
  "guarantor",
  "partner",
  "manager",
  "supplier_contact",
  "insurer_contact",
  "applicant",
  "other",
]);
export type PersonRoleRole = z.infer<typeof PersonRoleRole>;

export const LeaseKind = z.enum([
  "bare",
  "furnished",
  "mobility",
  "parking",
  "commercial",
  "professional",
  "tourist",
  "other",
]);
export type LeaseKind = z.infer<typeof LeaseKind>;

export const LeaseStatus = z.enum([
  "draft",
  "ready_to_sign",
  "signed",
  "active",
  "terminated",
  "archived",
  "cancelled",
  "disputed",
]);
export type LeaseStatus = z.infer<typeof LeaseStatus>;

export const LeaseChargeRegime = z.enum(["provision", "flat_fee", "none", "real_expenses"]);
export type LeaseChargeRegime = z.infer<typeof LeaseChargeRegime>;

export const LeaseTermPeriodicity = z.enum(["monthly", "quarterly", "yearly", "stay"]);
export type LeaseTermPeriodicity = z.infer<typeof LeaseTermPeriodicity>;

export const LeaseProrationRule = z.enum(["calendar_days", "thirty_day_month", "none"]);
export type LeaseProrationRule = z.infer<typeof LeaseProrationRule>;

export const LeaseRevisionIndex = z.enum(["irl", "ilc", "ilat", "none"]);
export type LeaseRevisionIndex = z.infer<typeof LeaseRevisionIndex>;

export const LeaseVersionKind = z.enum(["initial", "amendment", "renewal", "transfer"]);
export type LeaseVersionKind = z.infer<typeof LeaseVersionKind>;

export const LeasePartyRole = z.enum([
  "holder",
  "co_holder",
  "occupant",
  "guarantor",
  "payer_third_party",
  "landlord",
]);
export type LeasePartyRole = z.infer<typeof LeasePartyRole>;

export const LeaseUnitRole = z.enum(["main", "annex"]);
export type LeaseUnitRole = z.infer<typeof LeaseUnitRole>;

export const GuaranteeKind = z.enum([
  "personal_surety",
  "visale",
  "bank_guarantee",
  "company_surety",
  "other",
]);
export type GuaranteeKind = z.infer<typeof GuaranteeKind>;

export const GuaranteeStatus = z.enum(["draft", "active", "expired", "released", "invoked"]);
export type GuaranteeStatus = z.infer<typeof GuaranteeStatus>;

export const RentTermKind = z.enum([
  "rent",
  "charge_provision",
  "charge_flat_fee",
  "charge_regularization",
  "accessory",
  "deposit_call",
  "adjustment",
  "credit_note",
]);
export type RentTermKind = z.infer<typeof RentTermKind>;

export const RentTermStatus = z.enum([
  "planned",
  "authorized",
  "posted",
  "partially_settled",
  "settled",
  "disputed",
  "cancelled",
  "payment_rejected",
]);
export type RentTermStatus = z.infer<typeof RentTermStatus>;

export const RentTermVersionReason = z.enum([
  "initial",
  "revision",
  "proration",
  "correction",
  "indexation",
  "regularization",
]);
export type RentTermVersionReason = z.infer<typeof RentTermVersionReason>;

export const RentRevisionIndexName = z.enum(["irl", "ilc", "ilat"]);
export type RentRevisionIndexName = z.infer<typeof RentRevisionIndexName>;

export const RentRevisionStatus = z.enum([
  "blocked",
  "proposed",
  "approved",
  "applied",
  "refused",
  "expired",
]);
export type RentRevisionStatus = z.infer<typeof RentRevisionStatus>;

export const PaymentDirection = z.enum(["inbound", "outbound"]);
export type PaymentDirection = z.infer<typeof PaymentDirection>;

export const PaymentMethod = z.enum([
  "transfer",
  "direct_debit",
  "card",
  "cheque",
  "cash",
  "platform",
  "offset",
]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const PaymentStatus = z.enum([
  "to_qualify",
  "partially_allocated",
  "allocated",
  "overpaid",
  "refunded",
  "rejected",
  "cancelled",
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const DepositAccountStatus = z.enum([
  "expected",
  "open",
  "partially_released",
  "closed",
  "disputed",
]);
export type DepositAccountStatus = z.infer<typeof DepositAccountStatus>;

export const DepositMovementKind = z.enum([
  "received",
  "retained",
  "refunded",
  "transferred",
  "interest",
  "adjustment",
]);
export type DepositMovementKind = z.infer<typeof DepositMovementKind>;

export const RentReceiptKind = z.enum(["quittance", "recu_partiel"]);
export type RentReceiptKind = z.infer<typeof RentReceiptKind>;

export const RentReceiptDeliveryChannel = z.enum(["electronic", "postal", "handover"]);
export type RentReceiptDeliveryChannel = z.infer<typeof RentReceiptDeliveryChannel>;

export const RentReceiptStatus = z.enum(["issued", "delivered", "flagged", "superseded"]);
export type RentReceiptStatus = z.infer<typeof RentReceiptStatus>;

export const InspectionKind = z.enum(["entry", "exit", "intermediate"]);
export type InspectionKind = z.infer<typeof InspectionKind>;

export const InspectionStatus = z.enum([
  "draft",
  "in_progress",
  "pending_sync",
  "signed",
  "contested",
  "archived",
]);
export type InspectionStatus = z.infer<typeof InspectionStatus>;

export const InspectionFindingCondition = z.enum([
  "new",
  "good",
  "fair",
  "worn",
  "damaged",
  "missing",
  "not_checked",
]);
export type InspectionFindingCondition = z.infer<typeof InspectionFindingCondition>;

export const InventoryItemCondition = z.enum(["new", "good", "fair", "worn", "damaged", "missing"]);
export type InventoryItemCondition = z.infer<typeof InventoryItemCondition>;

export const EquipmentStatus = z.enum([
  "planned",
  "in_service",
  "out_of_service",
  "removed",
  "scrapped",
]);
export type EquipmentStatus = z.infer<typeof EquipmentStatus>;

export const MeterFluid = z.enum([
  "water_cold",
  "water_hot",
  "electricity",
  "gas",
  "heat",
  "pv_production",
  "other",
]);
export type MeterFluid = z.infer<typeof MeterFluid>;

export const MeterScope = z.enum(["individual", "sub_meter", "collective"]);
export type MeterScope = z.infer<typeof MeterScope>;

export const MeterStatus = z.enum(["active", "replaced", "removed", "faulty"]);
export type MeterStatus = z.infer<typeof MeterStatus>;

export const MeterReadingOrigin = z.enum([
  "owner",
  "tenant",
  "provider",
  "inspection",
  "estimate",
  "import",
]);
export type MeterReadingOrigin = z.infer<typeof MeterReadingOrigin>;

export const MeterReadingStatus = z.enum(["recorded", "validated", "exception", "rejected"]);
export type MeterReadingStatus = z.infer<typeof MeterReadingStatus>;

export const SupplierStatus = z.enum(["proposed", "active", "blocked", "archived"]);
export type SupplierStatus = z.infer<typeof SupplierStatus>;

export const WorksProjectNature = z.enum([
  "maintenance",
  "repair",
  "improvement",
  "construction",
  "to_qualify",
]);
export type WorksProjectNature = z.infer<typeof WorksProjectNature>;

export const WorksProjectAccountingTreatment = z.enum([
  "expense",
  "capitalized",
  "mixed",
  "to_qualify",
]);
export type WorksProjectAccountingTreatment = z.infer<typeof WorksProjectAccountingTreatment>;

export const WorksProjectStatus = z.enum([
  "draft",
  "planned",
  "in_progress",
  "done",
  "cancelled",
  "on_hold",
]);
export type WorksProjectStatus = z.infer<typeof WorksProjectStatus>;

export const InterventionUrgency = z.enum(["low", "normal", "high", "critical"]);
export type InterventionUrgency = z.infer<typeof InterventionUrgency>;

export const InterventionStatus = z.enum([
  "reported",
  "qualified",
  "scheduled",
  "in_progress",
  "done",
  "awaiting_part",
  "reopened",
  "cancelled",
]);
export type InterventionStatus = z.infer<typeof InterventionStatus>;

export const InterventionPerformedBy = z.enum(["owner", "supplier", "tenant", "insurer"]);
export type InterventionPerformedBy = z.infer<typeof InterventionPerformedBy>;

export const ExpenseDocumentKind = z.enum([
  "receipt",
  "invoice",
  "credit_note",
  "e_invoice",
  "statement",
]);
export type ExpenseDocumentKind = z.infer<typeof ExpenseDocumentKind>;

export const ExpensePayer = z.enum(["entity", "partner", "tenant", "insurer", "unknown"]);
export type ExpensePayer = z.infer<typeof ExpensePayer>;

export const ExpenseStatus = z.enum([
  "captured",
  "extracted",
  "to_review",
  "validated",
  "posted",
  "paid",
  "reconciled",
  "cancelled",
  "duplicate_suspect",
  "rejected",
]);
export type ExpenseStatus = z.infer<typeof ExpenseStatus>;

export const ChargeAllocationKeyBasis = z.enum([
  "tantiemes",
  "surface",
  "consumption",
  "occupants",
  "equal",
  "contractual",
  "other",
]);
export type ChargeAllocationKeyBasis = z.infer<typeof ChargeAllocationKeyBasis>;

export const ChargeAllocationKeyStatus = z.enum(["draft", "active", "retired"]);
export type ChargeAllocationKeyStatus = z.infer<typeof ChargeAllocationKeyStatus>;

export const ChargeAllocationKeyVersionRoundingRule = z.enum([
  "largest_remainder",
  "first_id",
  "last_id",
  "proportional_truncate",
]);
export type ChargeAllocationKeyVersionRoundingRule = z.infer<
  typeof ChargeAllocationKeyVersionRoundingRule
>;

export const ChargeAllocationKeyVersionStatus = z.enum(["draft", "active", "superseded"]);
export type ChargeAllocationKeyVersionStatus = z.infer<typeof ChargeAllocationKeyVersionStatus>;

export const ExpenseAllocationTarget = z.enum(["unit", "building_common", "entity_common"]);
export type ExpenseAllocationTarget = z.infer<typeof ExpenseAllocationTarget>;

export const ProvisionRegularizationRunStatus = z.enum([
  "draft",
  "computed",
  "frozen",
  "approved",
  "sent",
  "posted",
  "cancelled",
]);
export type ProvisionRegularizationRunStatus = z.infer<typeof ProvisionRegularizationRunStatus>;

export const LoanRateKind = z.enum(["fixed", "variable", "mixed"]);
export type LoanRateKind = z.infer<typeof LoanRateKind>;

export const LoanStatus = z.enum(["draft", "active", "renegotiated", "repaid", "cancelled"]);
export type LoanStatus = z.infer<typeof LoanStatus>;

export const LoanInsuranceBasis = z.enum(["initial_principal", "outstanding_principal"]);
export type LoanInsuranceBasis = z.infer<typeof LoanInsuranceBasis>;

export const IntegrationExchangeDirection = z.enum(["inbound", "outbound"]);
export type IntegrationExchangeDirection = z.infer<typeof IntegrationExchangeDirection>;

export const IntegrationExchangeStatus = z.enum([
  "pending",
  "success",
  "client_error",
  "server_error",
  "timeout",
  "rejected",
  "unknown",
]);
export type IntegrationExchangeStatus = z.infer<typeof IntegrationExchangeStatus>;

export const LoanScheduleVersionReason = z.enum([
  "initial",
  "renegotiation",
  "rate_change",
  "early_repayment",
  "modulation",
  "correction",
]);
export type LoanScheduleVersionReason = z.infer<typeof LoanScheduleVersionReason>;

export const LoanScheduleVersionSource = z.enum([
  "lender_document",
  "manual",
  "computed",
  "import",
]);
export type LoanScheduleVersionSource = z.infer<typeof LoanScheduleVersionSource>;

export const LoanScheduleVersionStatus = z.enum(["draft", "active", "superseded"]);
export type LoanScheduleVersionStatus = z.infer<typeof LoanScheduleVersionStatus>;

export const LoanInstallmentStatus = z.enum([
  "forecast",
  "due",
  "debited",
  "matched",
  "variance",
  "cancelled",
]);
export type LoanInstallmentStatus = z.infer<typeof LoanInstallmentStatus>;

export const PartnerCurrentAccountStatus = z.enum(["active", "closed", "under_review"]);
export type PartnerCurrentAccountStatus = z.infer<typeof PartnerCurrentAccountStatus>;

export const CcaMovementKind = z.enum([
  "contribution",
  "expense_paid_personally",
  "repayment",
  "interest",
  "offset",
  "correction",
]);
export type CcaMovementKind = z.infer<typeof CcaMovementKind>;

export const CcaMovementStatus = z.enum([
  "proposed",
  "validated",
  "posted",
  "rejected",
  "under_review",
]);
export type CcaMovementStatus = z.infer<typeof CcaMovementStatus>;

export const FixedAssetMethod = z.enum(["linear", "degressive", "components", "none"]);
export type FixedAssetMethod = z.infer<typeof FixedAssetMethod>;

export const FixedAssetStatus = z.enum([
  "draft",
  "running",
  "fully_depreciated",
  "disposed",
  "cancelled",
]);
export type FixedAssetStatus = z.infer<typeof FixedAssetStatus>;

export const InternalTransferStatus = z.enum([
  "expected",
  "in_transit",
  "settled",
  "mismatch",
  "cancelled",
]);
export type InternalTransferStatus = z.infer<typeof InternalTransferStatus>;

export const ListingPlatform = z.enum(["airbnb", "booking", "abritel", "direct", "other"]);
export type ListingPlatform = z.infer<typeof ListingPlatform>;

export const ListingStatus = z.enum(["draft", "active", "paused", "archived"]);
export type ListingStatus = z.infer<typeof ListingStatus>;

export const BookingStatus = z.enum([
  "blocked",
  "pending",
  "confirmed",
  "in_stay",
  "completed",
  "cancelled",
  "disputed",
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const BookingSource = z.enum(["ical", "file_import", "api", "manual"]);
export type BookingSource = z.infer<typeof BookingSource>;

export const BookingMovementKind = z.enum([
  "accommodation",
  "cleaning",
  "extra",
  "commission",
  "refund",
  "tourist_tax_collected",
  "tourist_tax_remitted",
  "damage_deposit",
  "adjustment",
]);
export type BookingMovementKind = z.infer<typeof BookingMovementKind>;

export const PayoutStatus = z.enum(["imported", "matched", "variance", "confirmed", "rejected"]);
export type PayoutStatus = z.infer<typeof PayoutStatus>;

export const InsurancePolicyKind = z.enum([
  "pno",
  "habitation",
  "borrower",
  "liability",
  "works",
  "multirisk",
  "other",
]);
export type InsurancePolicyKind = z.infer<typeof InsurancePolicyKind>;

export const InsurancePolicyPremiumPeriodicity = z.enum([
  "monthly",
  "quarterly",
  "yearly",
  "single",
]);
export type InsurancePolicyPremiumPeriodicity = z.infer<typeof InsurancePolicyPremiumPeriodicity>;

export const InsurancePolicyStatus = z.enum([
  "draft",
  "active",
  "expiring",
  "expired",
  "cancelled",
  "to_verify",
]);
export type InsurancePolicyStatus = z.infer<typeof InsurancePolicyStatus>;

export const ClaimStatus = z.enum([
  "draft",
  "declared",
  "open",
  "expertise",
  "settled",
  "refused",
  "closed",
  "litigation",
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const ClaimIndemnityKind = z.enum([
  "advance",
  "final",
  "complement",
  "recovery",
  "deductible",
]);
export type ClaimIndemnityKind = z.infer<typeof ClaimIndemnityKind>;

export const AcquisitionOpportunityStatus = z.enum([
  "idea",
  "studied",
  "offer_made",
  "under_promise",
  "signed",
  "converted",
  "abandoned",
]);
export type AcquisitionOpportunityStatus = z.infer<typeof AcquisitionOpportunityStatus>;

export const DocumentConfidentiality = z.enum([
  "public_to_tenant",
  "internal",
  "restricted",
  "sensitive",
]);
export type DocumentConfidentiality = z.infer<typeof DocumentConfidentiality>;

export const DocumentStatus = z.enum([
  "uploading",
  "active",
  "quarantined",
  "archived",
  "purged",
  "rejected",
]);
export type DocumentStatus = z.infer<typeof DocumentStatus>;

export const DocumentVersionRole = z.enum([
  "original",
  "signed",
  "ocr_text",
  "transcript",
  "thumbnail",
  "summary",
  "redacted",
  "export",
]);
export type DocumentVersionRole = z.infer<typeof DocumentVersionRole>;

export const DocumentVersionVirusScanStatus = z.enum([
  "pending",
  "clean",
  "infected",
  "skipped",
  "failed",
]);
export type DocumentVersionVirusScanStatus = z.infer<typeof DocumentVersionVirusScanStatus>;

export const ObjectRefKind = z.enum([
  "legal_entity",
  "building",
  "unit",
  "person",
  "lease",
  "rent_term",
  "payment",
  "deposit_account",
  "expense",
  "works_project",
  "intervention",
  "equipment",
  "meter",
  "loan",
  "partner_current_account",
  "fixed_asset",
  "insurance_policy",
  "claim",
  "booking",
  "listing",
  "inspection",
  "supplier",
  "bank_account",
  "document",
]);
export type ObjectRefKind = z.infer<typeof ObjectRefKind>;

export const DocumentLinkRelation = z.enum([
  "attached",
  "evidence",
  "signed_contract",
  "certificate",
  "invoice",
  "photo",
  "report",
  "identity",
  "other",
]);
export type DocumentLinkRelation = z.infer<typeof DocumentLinkRelation>;

export const ActivityChannel = z.enum([
  "email",
  "sms",
  "phone",
  "note",
  "voice",
  "photo",
  "file",
  "portal",
  "system",
  "whatsapp",
  "platform",
]);
export type ActivityChannel = z.infer<typeof ActivityChannel>;

export const ActivityDirection = z.enum(["inbound", "outbound", "internal"]);
export type ActivityDirection = z.infer<typeof ActivityDirection>;

export const EventOrigin = z.enum(["saas", "odoo", "platform", "import", "rule", "user"]);
export type EventOrigin = z.infer<typeof EventOrigin>;

export const DeadlinePriority = z.enum(["low", "normal", "high", "critical"]);
export type DeadlinePriority = z.infer<typeof DeadlinePriority>;

export const DeadlineRecurrenceAnchor = z.enum(["contract_date", "execution_date", "none"]);
export type DeadlineRecurrenceAnchor = z.infer<typeof DeadlineRecurrenceAnchor>;

export const DeadlineStatus = z.enum([
  "planned",
  "to_process",
  "done",
  "postponed",
  "blocked",
  "cancelled",
]);
export type DeadlineStatus = z.infer<typeof DeadlineStatus>;

export const ActivityLinkRelation = z.enum(["about", "from", "to", "mentions", "context"]);
export type ActivityLinkRelation = z.infer<typeof ActivityLinkRelation>;

export const EventLinkRelation = z.enum(["about", "primary", "impacted", "source", "context"]);
export type EventLinkRelation = z.infer<typeof EventLinkRelation>;

export const DeadlineLinkRelation = z.enum(["about", "responsible_for", "context"]);
export type DeadlineLinkRelation = z.infer<typeof DeadlineLinkRelation>;

export const InboxItemSource = z.enum([
  "mobile_capture",
  "email_forward",
  "file_drop",
  "sms_paste",
  "voice_note",
  "connector",
  "api",
  "platform_import",
]);
export type InboxItemSource = z.infer<typeof InboxItemSource>;

export const InboxItemStatus = z.enum([
  "received",
  "analyzed",
  "attached",
  "processed",
  "quarantined",
  "ambiguous",
  "suspected_duplicate",
  "rejected",
]);
export type InboxItemStatus = z.infer<typeof InboxItemStatus>;

export const MessageOutboundChannel = z.enum(["email", "sms", "postal", "portal"]);
export type MessageOutboundChannel = z.infer<typeof MessageOutboundChannel>;

export const MessageOutboundStatus = z.enum([
  "draft",
  "approved",
  "queued",
  "sent",
  "delivered",
  "unknown",
  "bounced",
  "failed",
  "cancelled",
]);
export type MessageOutboundStatus = z.infer<typeof MessageOutboundStatus>;

export const RuleDomain = z.enum([
  "rent_indexation",
  "charge_allocation",
  "expense_routing",
  "retention",
  "autonomy",
  "deadline_generation",
  "reconciliation",
  "dunning",
  "tourist_import",
]);
export type RuleDomain = z.infer<typeof RuleDomain>;

export const RuleOrigin = z.enum(["manual", "proposed_by_pattern", "template"]);
export type RuleOrigin = z.infer<typeof RuleOrigin>;

export const RuleStatus = z.enum(["draft", "proposed", "active", "suspended", "retired"]);
export type RuleStatus = z.infer<typeof RuleStatus>;

export const RuleVersionStatus = z.enum(["draft", "active", "superseded", "revoked"]);
export type RuleVersionStatus = z.infer<typeof RuleVersionStatus>;

export const AiExtractionDecision = z.enum([
  "pending",
  "accepted",
  "corrected",
  "rejected",
  "superseded",
]);
export type AiExtractionDecision = z.infer<typeof AiExtractionDecision>;

export const AiExtractionAutonomyLevel = z.enum(["A", "B", "C", "D"]);
export type AiExtractionAutonomyLevel = z.infer<typeof AiExtractionAutonomyLevel>;

export const CommandAutonomyLevel = z.enum(["A", "B", "C", "D"]);
export type CommandAutonomyLevel = z.infer<typeof CommandAutonomyLevel>;

export const CommandStatus = z.enum([
  "prepared",
  "authorized",
  "sent",
  "confirmed",
  "rejected",
  "unknown_result",
  "conflict",
  "compensation_required",
  "cancelled",
]);
export type CommandStatus = z.infer<typeof CommandStatus>;

export const CommandErrorType = z.enum([
  "validation",
  "permission",
  "version_conflict",
  "closed_period",
  "provider_unavailable",
  "quota",
  "ambiguous_reference",
  "unknown_result",
]);
export type CommandErrorType = z.infer<typeof CommandErrorType>;

export const ApprovalDecision = z.enum(["approved", "refused"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const CommandAttemptOutcome = z.enum([
  "running",
  "success",
  "failure",
  "timeout",
  "unknown",
  "skipped",
]);
export type CommandAttemptOutcome = z.infer<typeof CommandAttemptOutcome>;

export const OutboxEntryChannel = z.enum(["odoo", "email", "sms", "postal", "webhook", "internal"]);
export type OutboxEntryChannel = z.infer<typeof OutboxEntryChannel>;

export const OutboxEntryStatus = z.enum([
  "pending",
  "leased",
  "sent",
  "confirmed",
  "failed",
  "dead_letter",
  "cancelled",
]);
export type OutboxEntryStatus = z.infer<typeof OutboxEntryStatus>;

export const ExternalRefSystem = z.enum([
  "odoo",
  "airbnb",
  "bank",
  "signature",
  "einvoicing",
  "other",
]);
export type ExternalRefSystem = z.infer<typeof ExternalRefSystem>;

export const ExternalRefStatus = z.enum(["active", "archived", "deleted_remotely", "conflict"]);
export type ExternalRefStatus = z.infer<typeof ExternalRefStatus>;

export const IntegrationCursorCursorKind = z.enum([
  "write_date_id",
  "history_id",
  "delta_token",
  "timestamp",
  "page_token",
]);
export type IntegrationCursorCursorKind = z.infer<typeof IntegrationCursorCursorKind>;

export const IntegrationCursorHealth = z.enum(["healthy", "degraded", "stalled", "unavailable"]);
export type IntegrationCursorHealth = z.infer<typeof IntegrationCursorHealth>;

export const AuditLogActorKind = z.enum(["user", "technical", "system", "connector"]);
export type AuditLogActorKind = z.infer<typeof AuditLogActorKind>;

export const AuditLogResult = z.enum(["success", "failure", "refused", "partial"]);
export type AuditLogResult = z.infer<typeof AuditLogResult>;

/** Provenance of every enum above: "<table>.<column>" of docs/schema/lfsci.sql. */
export const sqlEnums = {
  "organization.status": OrganizationStatus,
  "app_user.status": AppUserStatus,
  "membership.role": MembershipRole,
  "membership.status": MembershipStatus,
  "legal_entity.legal_form": LegalEntityLegalForm,
  "legal_entity.income_tax_regime": LegalEntityIncomeTaxRegime,
  "legal_entity.vat_status": LegalEntityVatStatus,
  "legal_entity.e_invoicing_channel": LegalEntityEInvoicingChannel,
  "legal_entity.status": LegalEntityStatus,
  "loan.insurance_basis": LoanInsuranceBasis,
  "integration_exchange.direction": IntegrationExchangeDirection,
  "integration_exchange.status": IntegrationExchangeStatus,
  "bank_account.purpose": BankAccountPurpose,
  "bank_account.feed_source": BankAccountFeedSource,
  "bank_account.status": BankAccountStatus,
  "bank_transaction.reconciliation_status": BankTransactionReconciliationStatus,
  "building.status": BuildingStatus,
  "unit.kind": UnitKind,
  "unit.energy_class": UnitEnergyClass,
  "unit.status": UnitStatus,
  "unit_lineage.operation": UnitLineageOperation,
  "unit_usage_period.usage": UnitUsagePeriodUsage,
  "unit_diagnostic.kind": UnitDiagnosticKind,
  "unit_diagnostic.status": UnitDiagnosticStatus,
  "person.kind": PersonKind,
  "person.status": PersonStatus,
  "contact_point.kind": ContactPointKind,
  "contact_point.status": ContactPointStatus,
  "person_role.role": PersonRoleRole,
  "lease.kind": LeaseKind,
  "lease.status": LeaseStatus,
  "lease.charge_regime": LeaseChargeRegime,
  "lease.term_periodicity": LeaseTermPeriodicity,
  "lease.proration_rule": LeaseProrationRule,
  "lease.revision_index": LeaseRevisionIndex,
  "lease_version.kind": LeaseVersionKind,
  "lease_party.role": LeasePartyRole,
  "lease_unit.role": LeaseUnitRole,
  "guarantee.kind": GuaranteeKind,
  "guarantee.status": GuaranteeStatus,
  "rent_term.kind": RentTermKind,
  "rent_term.status": RentTermStatus,
  "rent_term_version.reason": RentTermVersionReason,
  "rent_revision.index_name": RentRevisionIndexName,
  "rent_revision.status": RentRevisionStatus,
  "payment.direction": PaymentDirection,
  "payment.method": PaymentMethod,
  "payment.status": PaymentStatus,
  "deposit_account.status": DepositAccountStatus,
  "deposit_movement.kind": DepositMovementKind,
  "rent_receipt.kind": RentReceiptKind,
  "rent_receipt.delivery_channel": RentReceiptDeliveryChannel,
  "rent_receipt.status": RentReceiptStatus,
  "inspection.kind": InspectionKind,
  "inspection.status": InspectionStatus,
  "inspection_finding.condition": InspectionFindingCondition,
  "inventory_item.condition": InventoryItemCondition,
  "equipment.status": EquipmentStatus,
  "meter.fluid": MeterFluid,
  "meter.scope": MeterScope,
  "meter.status": MeterStatus,
  "meter_reading.origin": MeterReadingOrigin,
  "meter_reading.status": MeterReadingStatus,
  "supplier.status": SupplierStatus,
  "works_project.nature": WorksProjectNature,
  "works_project.accounting_treatment": WorksProjectAccountingTreatment,
  "works_project.status": WorksProjectStatus,
  "intervention.urgency": InterventionUrgency,
  "intervention.status": InterventionStatus,
  "intervention.performed_by": InterventionPerformedBy,
  "expense.document_kind": ExpenseDocumentKind,
  "expense.payer": ExpensePayer,
  "expense.status": ExpenseStatus,
  "charge_allocation_key.basis": ChargeAllocationKeyBasis,
  "charge_allocation_key.status": ChargeAllocationKeyStatus,
  "charge_allocation_key_version.rounding_rule": ChargeAllocationKeyVersionRoundingRule,
  "charge_allocation_key_version.status": ChargeAllocationKeyVersionStatus,
  "expense_allocation.target": ExpenseAllocationTarget,
  "provision_regularization_run.status": ProvisionRegularizationRunStatus,
  "loan.rate_kind": LoanRateKind,
  "loan.status": LoanStatus,
  "loan_schedule_version.reason": LoanScheduleVersionReason,
  "loan_schedule_version.source": LoanScheduleVersionSource,
  "loan_schedule_version.status": LoanScheduleVersionStatus,
  "loan_installment.status": LoanInstallmentStatus,
  "partner_current_account.status": PartnerCurrentAccountStatus,
  "cca_movement.kind": CcaMovementKind,
  "cca_movement.status": CcaMovementStatus,
  "fixed_asset.method": FixedAssetMethod,
  "fixed_asset.status": FixedAssetStatus,
  "internal_transfer.status": InternalTransferStatus,
  "listing.platform": ListingPlatform,
  "listing.status": ListingStatus,
  "booking.status": BookingStatus,
  "booking.source": BookingSource,
  "booking_movement.kind": BookingMovementKind,
  "payout.status": PayoutStatus,
  "insurance_policy.kind": InsurancePolicyKind,
  "insurance_policy.premium_periodicity": InsurancePolicyPremiumPeriodicity,
  "insurance_policy.status": InsurancePolicyStatus,
  "claim.status": ClaimStatus,
  "claim_indemnity.kind": ClaimIndemnityKind,
  "acquisition_opportunity.status": AcquisitionOpportunityStatus,
  "document.confidentiality": DocumentConfidentiality,
  "document.status": DocumentStatus,
  "document_version.role": DocumentVersionRole,
  "document_version.virus_scan_status": DocumentVersionVirusScanStatus,
  "object_ref.kind": ObjectRefKind,
  "document_link.relation": DocumentLinkRelation,
  "activity.channel": ActivityChannel,
  "activity.direction": ActivityDirection,
  "event.origin": EventOrigin,
  "deadline.priority": DeadlinePriority,
  "deadline.recurrence_anchor": DeadlineRecurrenceAnchor,
  "deadline.status": DeadlineStatus,
  "activity_link.relation": ActivityLinkRelation,
  "event_link.relation": EventLinkRelation,
  "deadline_link.relation": DeadlineLinkRelation,
  "inbox_item.source": InboxItemSource,
  "inbox_item.status": InboxItemStatus,
  "message_outbound.channel": MessageOutboundChannel,
  "message_outbound.status": MessageOutboundStatus,
  "rule.domain": RuleDomain,
  "rule.origin": RuleOrigin,
  "rule.status": RuleStatus,
  "rule_version.status": RuleVersionStatus,
  "ai_extraction.decision": AiExtractionDecision,
  "ai_extraction.autonomy_level": AiExtractionAutonomyLevel,
  "command.autonomy_level": CommandAutonomyLevel,
  "command.status": CommandStatus,
  "command.error_type": CommandErrorType,
  "approval.decision": ApprovalDecision,
  "command_attempt.outcome": CommandAttemptOutcome,
  "outbox_entry.channel": OutboxEntryChannel,
  "outbox_entry.status": OutboxEntryStatus,
  "external_ref.system": ExternalRefSystem,
  "external_ref.status": ExternalRefStatus,
  "integration_cursor.cursor_kind": IntegrationCursorCursorKind,
  "integration_cursor.health": IntegrationCursorHealth,
  "audit_log.actor_kind": AuditLogActorKind,
  "audit_log.result": AuditLogResult,
} as const satisfies Record<string, z.ZodEnum<Record<string, string>>>;

// Friendly aliases for the enums the rest of the contract refers to by their
// business name rather than by their table.
export const VatStatus = LegalEntityVatStatus;
export type VatStatus = LegalEntityVatStatus;

export const ObjectKind = ObjectRefKind;
export type ObjectKind = ObjectRefKind;

export const ActivityKind = ActivityChannel;
export type ActivityKind = ActivityChannel;
