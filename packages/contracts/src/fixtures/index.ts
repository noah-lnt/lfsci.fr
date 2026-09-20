import type { z } from "zod";
import { Approval, CreateApprovalInput } from "../approvals";
import * as C from "../commands";
import * as E from "../entities";
import * as K from "./commands";
import * as F from "./entities";

export * from "./commands";
export * from "./entities";
export * from "./ids";

type FixtureCase = { name: string; schema: z.ZodType; value: unknown };

const entityCases: FixtureCase[] = [
  { name: "Organization", schema: E.Organization, value: F.organizationFixture },
  { name: "AppUser", schema: E.AppUser, value: F.appUserFixture },
  { name: "Membership", schema: E.Membership, value: F.membershipFixture },
  { name: "LegalEntity", schema: E.LegalEntity, value: F.legalEntityFixture },
  {
    name: "CreateLegalEntityInput",
    schema: E.CreateLegalEntityInput,
    value: F.createLegalEntityInputFixture,
  },
  {
    name: "UpdateLegalEntityInput",
    schema: E.UpdateLegalEntityInput,
    value: F.updateLegalEntityInputFixture,
  },
  { name: "BankAccount", schema: E.BankAccount, value: F.bankAccountFixture },
  { name: "Building", schema: E.Building, value: F.buildingFixture },
  {
    name: "CreateBuildingInput",
    schema: E.CreateBuildingInput,
    value: F.createBuildingInputFixture,
  },
  {
    name: "UpdateBuildingInput",
    schema: E.UpdateBuildingInput,
    value: F.updateBuildingInputFixture,
  },
  { name: "Unit", schema: E.Unit, value: F.unitFixture },
  { name: "CreateUnitInput", schema: E.CreateUnitInput, value: F.createUnitInputFixture },
  { name: "UpdateUnitInput", schema: E.UpdateUnitInput, value: F.updateUnitInputFixture },
  { name: "UnitUsagePeriod", schema: E.UnitUsagePeriod, value: F.unitUsagePeriodFixture },
  { name: "Person", schema: E.Person, value: F.personFixture },
  { name: "ContactPoint", schema: E.ContactPoint, value: F.contactPointFixture },
  { name: "CreatePersonInput", schema: E.CreatePersonInput, value: F.createPersonInputFixture },
  { name: "UpdatePersonInput", schema: E.UpdatePersonInput, value: F.updatePersonInputFixture },
  { name: "Lease", schema: E.Lease, value: F.leaseFixture },
  { name: "LeaseParty", schema: E.LeaseParty, value: F.leasePartyFixture },
  { name: "LeaseUnit", schema: E.LeaseUnit, value: F.leaseUnitFixture },
  { name: "CreateLeaseInput", schema: E.CreateLeaseInput, value: F.createLeaseInputFixture },
  { name: "UpdateLeaseInput", schema: E.UpdateLeaseInput, value: F.updateLeaseInputFixture },
  { name: "RentTerm", schema: E.RentTerm, value: F.rentTermFixture },
  { name: "RentTermVersion", schema: E.RentTermVersion, value: F.rentTermVersionFixture },
  { name: "Payment", schema: E.Payment, value: F.paymentFixture },
  { name: "PaymentAllocation", schema: E.PaymentAllocation, value: F.paymentAllocationFixture },
  { name: "DepositAccount", schema: E.DepositAccount, value: F.depositAccountFixture },
  { name: "DepositMovement", schema: E.DepositMovement, value: F.depositMovementFixture },
  { name: "RentReceipt", schema: E.RentReceipt, value: F.rentReceiptFixture },
  { name: "Supplier", schema: E.Supplier, value: F.supplierFixture },
  { name: "Expense", schema: E.Expense, value: F.expenseFixture },
  { name: "ExpenseLine", schema: E.ExpenseLine, value: F.expenseLineFixture },
  { name: "ExpenseAllocation", schema: E.ExpenseAllocation, value: F.expenseAllocationFixture },
  {
    name: "CaptureExpenseInput",
    schema: E.CaptureExpenseInput,
    value: F.captureExpenseInputFixture,
  },
  {
    name: "UpdateExpenseInput",
    schema: E.UpdateExpenseInput,
    value: F.updateExpenseInputFixture,
  },
  { name: "WorksProject", schema: E.WorksProject, value: F.worksProjectFixture },
  { name: "Intervention", schema: E.Intervention, value: F.interventionFixture },
  {
    name: "CreateInterventionInput",
    schema: E.CreateInterventionInput,
    value: F.createInterventionInputFixture,
  },
  {
    name: "UpdateInterventionInput",
    schema: E.UpdateInterventionInput,
    value: F.updateInterventionInputFixture,
  },
  { name: "Equipment", schema: E.Equipment, value: F.equipmentFixture },
  { name: "Meter", schema: E.Meter, value: F.meterFixture },
  { name: "MeterReading", schema: E.MeterReading, value: F.meterReadingFixture },
  {
    name: "CreateMeterReadingInput",
    schema: E.CreateMeterReadingInput,
    value: F.createMeterReadingInputFixture,
  },
  { name: "Loan", schema: E.Loan, value: F.loanFixture },
  { name: "LoanInstallment", schema: E.LoanInstallment, value: F.loanInstallmentFixture },
  { name: "CreateLoanInput", schema: E.CreateLoanInput, value: F.createLoanInputFixture },
  { name: "UpdateLoanInput", schema: E.UpdateLoanInput, value: F.updateLoanInputFixture },
  {
    name: "PartnerCurrentAccount",
    schema: E.PartnerCurrentAccount,
    value: F.partnerCurrentAccountFixture,
  },
  { name: "CcaMovement", schema: E.CcaMovement, value: F.ccaMovementFixture },
  {
    name: "CreateCcaMovementInput",
    schema: E.CreateCcaMovementInput,
    value: F.createCcaMovementInputFixture,
  },
  { name: "FixedAsset", schema: E.FixedAsset, value: F.fixedAssetFixture },
  { name: "Document", schema: E.DocumentEntity, value: F.documentFixture },
  { name: "DocumentVersion", schema: E.DocumentVersion, value: F.documentVersionFixture },
  {
    name: "CreateDocumentMetadataInput",
    schema: E.CreateDocumentMetadataInput,
    value: F.createDocumentMetadataInputFixture,
  },
  {
    name: "UpdateDocumentMetadataInput",
    schema: E.UpdateDocumentMetadataInput,
    value: F.updateDocumentMetadataInputFixture,
  },
  { name: "Activity", schema: E.Activity, value: F.activityFixture },
  { name: "Event", schema: E.EventEntity, value: F.eventFixture },
  { name: "Deadline", schema: E.Deadline, value: F.deadlineFixture },
  { name: "InboxItem", schema: E.InboxItem, value: F.inboxItemFixture },
  {
    name: "InboxDecisionInput",
    schema: E.InboxDecisionInput,
    value: F.inboxDecisionInputFixture,
  },
  { name: "InboxIntent", schema: E.InboxIntent, value: F.inboxIntentFixture },
  { name: "InsurancePolicy", schema: E.InsurancePolicy, value: F.insurancePolicyFixture },
  { name: "Claim", schema: E.Claim, value: F.claimFixture },
  { name: "Booking", schema: E.Booking, value: F.bookingFixture },
  { name: "Payout", schema: E.Payout, value: F.payoutFixture },
  { name: "Rule", schema: E.Rule, value: F.ruleFixture },
  { name: "RuleVersion", schema: E.RuleVersionEntity, value: F.ruleVersionFixture },
  { name: "Command", schema: E.Command, value: F.commandFixture },
  { name: "CommandAttempt", schema: E.CommandAttempt, value: F.commandAttemptFixture },
  { name: "AiExtraction", schema: E.AiExtraction, value: F.aiExtractionFixture },
  { name: "IntegrationHealth", schema: E.IntegrationHealth, value: F.integrationHealthFixture },
  { name: "Approval", schema: Approval, value: K.approvalFixture },
  { name: "CreateApprovalInput", schema: CreateApprovalInput, value: K.createApprovalInputFixture },
];

const commandCases: FixtureCase[] = C.CommandType.options.flatMap((type) => [
  {
    name: `payload:${type}`,
    schema: C.commandPayloads[type],
    value: K.commandPayloadFixtures[type],
  },
  {
    name: `envelope:${type}`,
    schema: C.CommandEnvelope,
    value: K.commandEnvelopeFixtures[type],
  },
]);

/** Every fixture with the schema it must satisfy; the contract tests iterate this list. */
export const contractFixtures: readonly FixtureCase[] = [...entityCases, ...commandCases];
