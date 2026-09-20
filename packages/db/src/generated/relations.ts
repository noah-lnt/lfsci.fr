import { relations } from "drizzle-orm/relations";
import { legalEntity, bankAccount, organization, building, unitDiagnostic, unit, document, contactPoint, person, appUser, aiExtraction, inboxItem, ruleVersion, activity, documentVersion, objectRef, auditLog, approval, command, equipment, assetComponent, fixedAsset, acquisitionOpportunity, acquisitionScenario, activityLink, bankTransaction, booking, listing, bookingMovement, ccaMovement, partnerCurrentAccount, expense, payment, chargeAllocationKey, chargeAllocationKeyVersion, chargeAllocationShare, claim, lease, insurancePolicy, claimIndemnity, externalRef, commandAttempt, deadline, event, deadlineLink, depositAccount, depositMovement, rentTerm, documentLink, embedding, supplier, equipmentAssignment, eventLink, intervention, worksProject, expenseAllocation, expenseLine, guarantee, inspection, inspectionFinding, integrationCursor, internalTransfer, inventoryItem, leaseParty, leaseUnit, loan, leaseVersion, loanInstallment, loanScheduleVersion, outboxEntry, messageOutbound, loanProperty, membership, meter, meterReading, meterConsumption, meterServicePeriod, paymentAllocation, rentTermVersion, provisionRegularizationRun, payout, payoutDetail, personRole, policyScope, provisionRegularizationLine, rentReceipt, rentRevision, rule, searchDocument, unitLineage, unitUsagePeriod, authUser, authSession, authAccount, authOrganization, authMember, authInvitation, authTwoFactor, integrationExchange } from "./schema";

export const bankAccountRelations = relations(bankAccount, ({one, many}) => ({
	legalEntity: one(legalEntity, {
		fields: [bankAccount.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [bankAccount.organizationId],
		references: [organization.id]
	}),
	bankTransactions: many(bankTransaction),
	internalTransfers_sourceBankAccountId: many(internalTransfer, {
		relationName: "internalTransfer_sourceBankAccountId_bankAccount_id"
	}),
	internalTransfers_targetBankAccountId: many(internalTransfer, {
		relationName: "internalTransfer_targetBankAccountId_bankAccount_id"
	}),
	loans: many(loan),
	objectRefs: many(objectRef),
}));

export const legalEntityRelations = relations(legalEntity, ({one, many}) => ({
	bankAccounts: many(bankAccount),
	acquisitionOpportunities: many(acquisitionOpportunity),
	buildings: many(building),
	chargeAllocationKeys: many(chargeAllocationKey),
	expenses: many(expense),
	expenseAllocations: many(expenseAllocation),
	fixedAssets: many(fixedAsset),
	guarantees: many(guarantee),
	insurancePolicies: many(insurancePolicy),
	internalTransfers: many(internalTransfer),
	appUser: one(appUser, {
		fields: [legalEntity.fiscalQualificationValidatedBy],
		references: [appUser.id]
	}),
	organization: one(organization, {
		fields: [legalEntity.organizationId],
		references: [organization.id]
	}),
	leases: many(lease),
	loans: many(loan),
	objectRefs: many(objectRef),
	partnerCurrentAccounts: many(partnerCurrentAccount),
	payments: many(payment),
	payouts: many(payout),
	personRoles: many(personRole),
	provisionRegularizationRuns: many(provisionRegularizationRun),
	worksProjects: many(worksProject),
}));

export const organizationRelations = relations(organization, ({many}) => ({
	bankAccounts: many(bankAccount),
	unitDiagnostics: many(unitDiagnostic),
	contactPoints: many(contactPoint),
	aiExtractions: many(aiExtraction),
	auditLogs: many(auditLog),
	approvals: many(approval),
	assetComponents: many(assetComponent),
	acquisitionOpportunities: many(acquisitionOpportunity),
	acquisitionScenarios: many(acquisitionScenario),
	activities: many(activity),
	activityLinks: many(activityLink),
	bankTransactions: many(bankTransaction),
	bookings: many(booking),
	bookingMovements: many(bookingMovement),
	buildings: many(building),
	ccaMovements: many(ccaMovement),
	chargeAllocationKeys: many(chargeAllocationKey),
	chargeAllocationKeyVersions: many(chargeAllocationKeyVersion),
	chargeAllocationShares: many(chargeAllocationShare),
	claims: many(claim),
	claimIndemnities: many(claimIndemnity),
	commands: many(command),
	commandAttempts: many(commandAttempt),
	deadlines: many(deadline),
	deadlineLinks: many(deadlineLink),
	depositAccounts: many(depositAccount),
	depositMovements: many(depositMovement),
	documents: many(document),
	documentLinks: many(documentLink),
	documentVersions: many(documentVersion),
	embeddings: many(embedding),
	equipment: many(equipment),
	equipmentAssignments: many(equipmentAssignment),
	events: many(event),
	eventLinks: many(eventLink),
	expenses: many(expense),
	expenseAllocations: many(expenseAllocation),
	expenseLines: many(expenseLine),
	externalRefs: many(externalRef),
	fixedAssets: many(fixedAsset),
	guarantees: many(guarantee),
	inboxItems: many(inboxItem),
	inspections: many(inspection),
	inspectionFindings: many(inspectionFinding),
	insurancePolicies: many(insurancePolicy),
	integrationCursors: many(integrationCursor),
	internalTransfers: many(internalTransfer),
	interventions: many(intervention),
	inventoryItems: many(inventoryItem),
	legalEntities: many(legalEntity),
	leases: many(lease),
	leaseParties: many(leaseParty),
	leaseUnits: many(leaseUnit),
	loans: many(loan),
	leaseVersions: many(leaseVersion),
	listings: many(listing),
	loanInstallments: many(loanInstallment),
	outboxEntries: many(outboxEntry),
	loanProperties: many(loanProperty),
	loanScheduleVersions: many(loanScheduleVersion),
	memberships: many(membership),
	messageOutbounds: many(messageOutbound),
	meters: many(meter),
	meterConsumptions: many(meterConsumption),
	meterReadings: many(meterReading),
	meterServicePeriods: many(meterServicePeriod),
	objectRefs: many(objectRef),
	partnerCurrentAccounts: many(partnerCurrentAccount),
	payments: many(payment),
	paymentAllocations: many(paymentAllocation),
	rentTerms: many(rentTerm),
	payouts: many(payout),
	payoutDetails: many(payoutDetail),
	people: many(person),
	personRoles: many(personRole),
	policyScopes: many(policyScope),
	provisionRegularizationLines: many(provisionRegularizationLine),
	provisionRegularizationRuns: many(provisionRegularizationRun),
	rentReceipts: many(rentReceipt),
	rentRevisions: many(rentRevision),
	rentTermVersions: many(rentTermVersion),
	rules: many(rule),
	ruleVersions: many(ruleVersion),
	searchDocuments: many(searchDocument),
	suppliers: many(supplier),
	units: many(unit),
	unitLineages: many(unitLineage),
	unitUsagePeriods: many(unitUsagePeriod),
	worksProjects: many(worksProject),
	integrationExchanges: many(integrationExchange),
}));

export const unitDiagnosticRelations = relations(unitDiagnostic, ({one}) => ({
	building: one(building, {
		fields: [unitDiagnostic.buildingId],
		references: [building.id]
	}),
	organization: one(organization, {
		fields: [unitDiagnostic.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [unitDiagnostic.unitId],
		references: [unit.id]
	}),
}));

export const buildingRelations = relations(building, ({one, many}) => ({
	unitDiagnostics: many(unitDiagnostic),
	acquisitionOpportunities: many(acquisitionOpportunity),
	legalEntity: one(legalEntity, {
		fields: [building.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [building.organizationId],
		references: [organization.id]
	}),
	chargeAllocationKeys: many(chargeAllocationKey),
	chargeAllocationShares: many(chargeAllocationShare),
	claims: many(claim),
	equipmentAssignments: many(equipmentAssignment),
	expenseAllocations: many(expenseAllocation),
	fixedAssets: many(fixedAsset),
	interventions: many(intervention),
	loanProperties: many(loanProperty),
	meters: many(meter),
	objectRefs: many(objectRef),
	policyScopes: many(policyScope),
	provisionRegularizationRuns: many(provisionRegularizationRun),
	units: many(unit),
	worksProjects: many(worksProject),
}));

export const unitRelations = relations(unit, ({one, many}) => ({
	unitDiagnostics: many(unitDiagnostic),
	bookings: many(booking),
	chargeAllocationShares: many(chargeAllocationShare),
	claims: many(claim),
	equipmentAssignments: many(equipmentAssignment),
	expenseAllocations: many(expenseAllocation),
	fixedAssets: many(fixedAsset),
	inspections: many(inspection),
	interventions: many(intervention),
	inventoryItems: many(inventoryItem),
	leaseUnits: many(leaseUnit),
	listings: many(listing),
	loanProperties: many(loanProperty),
	meterServicePeriods: many(meterServicePeriod),
	objectRefs: many(objectRef),
	policyScopes: many(policyScope),
	provisionRegularizationLines: many(provisionRegularizationLine),
	building: one(building, {
		fields: [unit.buildingId],
		references: [building.id]
	}),
	organization: one(organization, {
		fields: [unit.organizationId],
		references: [organization.id]
	}),
	unitLineages_sourceUnitId: many(unitLineage, {
		relationName: "unitLineage_sourceUnitId_unit_id"
	}),
	unitLineages_targetUnitId: many(unitLineage, {
		relationName: "unitLineage_targetUnitId_unit_id"
	}),
	unitUsagePeriods: many(unitUsagePeriod),
	worksProjects: many(worksProject),
}));

export const contactPointRelations = relations(contactPoint, ({one, many}) => ({
	document: one(document, {
		fields: [contactPoint.consentEvidenceDocumentId],
		references: [document.id]
	}),
	organization: one(organization, {
		fields: [contactPoint.organizationId],
		references: [organization.id]
	}),
	person: one(person, {
		fields: [contactPoint.personId],
		references: [person.id]
	}),
	messageOutbounds: many(messageOutbound),
	rentReceipts: many(rentReceipt),
}));

export const documentRelations = relations(document, ({one, many}) => ({
	contactPoints: many(contactPoint),
	depositMovements: many(depositMovement),
	person: one(person, {
		fields: [document.authorPersonId],
		references: [person.id]
	}),
	appUser: one(appUser, {
		fields: [document.authorUserId],
		references: [appUser.id]
	}),
	documentVersion: one(documentVersion, {
		fields: [document.currentVersionId],
		references: [documentVersion.id],
		relationName: "document_currentVersionId_documentVersion_id"
	}),
	organization: one(organization, {
		fields: [document.organizationId],
		references: [organization.id]
	}),
	documentLinks: many(documentLink),
	documentVersions: many(documentVersion, {
		relationName: "documentVersion_documentId_document_id"
	}),
	guarantees: many(guarantee),
	inboxItems: many(inboxItem),
	inspections: many(inspection),
	insurancePolicies_lastCertificateDocumentId: many(insurancePolicy, {
		relationName: "insurancePolicy_lastCertificateDocumentId_document_id"
	}),
	insurancePolicies_contractDocumentId: many(insurancePolicy, {
		relationName: "insurancePolicy_contractDocumentId_document_id"
	}),
	leaseVersions: many(leaseVersion),
	loanScheduleVersions: many(loanScheduleVersion),
	meterReadings: many(meterReading),
	objectRefs: many(objectRef),
	partnerCurrentAccounts: many(partnerCurrentAccount),
	rentReceipts: many(rentReceipt),
}));

export const personRelations = relations(person, ({one, many}) => ({
	contactPoints: many(contactPoint),
	activities: many(activity),
	bookings: many(booking),
	documents: many(document),
	expenses: many(expense),
	guarantees: many(guarantee),
	insurancePolicies: many(insurancePolicy),
	leaseParties: many(leaseParty),
	messageOutbounds: many(messageOutbound),
	objectRefs: many(objectRef),
	partnerCurrentAccounts: many(partnerCurrentAccount),
	payments: many(payment),
	organization: one(organization, {
		fields: [person.organizationId],
		references: [organization.id]
	}),
	personRoles: many(personRole),
	suppliers: many(supplier),
}));

export const aiExtractionRelations = relations(aiExtraction, ({one, many}) => ({
	appUser: one(appUser, {
		fields: [aiExtraction.decidedBy],
		references: [appUser.id]
	}),
	inboxItem: one(inboxItem, {
		fields: [aiExtraction.inboxItemId],
		references: [inboxItem.id]
	}),
	organization: one(organization, {
		fields: [aiExtraction.organizationId],
		references: [organization.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [aiExtraction.ruleVersionId],
		references: [ruleVersion.id]
	}),
	activity: one(activity, {
		fields: [aiExtraction.sourceActivityId],
		references: [activity.id]
	}),
	documentVersion: one(documentVersion, {
		fields: [aiExtraction.sourceDocumentVersionId],
		references: [documentVersion.id]
	}),
	objectRef: one(objectRef, {
		fields: [aiExtraction.subjectObjectRefId],
		references: [objectRef.id]
	}),
	expenseAllocations: many(expenseAllocation),
}));

export const appUserRelations = relations(appUser, ({many}) => ({
	aiExtractions: many(aiExtraction),
	auditLogs: many(auditLog),
	approvals: many(approval),
	activities: many(activity),
	chargeAllocationKeyVersions: many(chargeAllocationKeyVersion),
	commands: many(command),
	deadlines: many(deadline),
	documents: many(document),
	documentVersions: many(documentVersion),
	events: many(event),
	inboxItems: many(inboxItem),
	legalEntities: many(legalEntity),
	memberships: many(membership),
	meterReadings: many(meterReading),
	ruleVersions: many(ruleVersion),
	suppliers: many(supplier),
}));

export const inboxItemRelations = relations(inboxItem, ({one, many}) => ({
	aiExtractions: many(aiExtraction),
	activity: one(activity, {
		fields: [inboxItem.activityId],
		references: [activity.id]
	}),
	document: one(document, {
		fields: [inboxItem.documentId],
		references: [document.id]
	}),
	inboxItem: one(inboxItem, {
		fields: [inboxItem.duplicateOfInboxItemId],
		references: [inboxItem.id],
		relationName: "inboxItem_duplicateOfInboxItemId_inboxItem_id"
	}),
	inboxItems: many(inboxItem, {
		relationName: "inboxItem_duplicateOfInboxItemId_inboxItem_id"
	}),
	organization: one(organization, {
		fields: [inboxItem.organizationId],
		references: [organization.id]
	}),
	appUser: one(appUser, {
		fields: [inboxItem.processedBy],
		references: [appUser.id]
	}),
	objectRef: one(objectRef, {
		fields: [inboxItem.proposedObjectRefId],
		references: [objectRef.id]
	}),
}));

export const ruleVersionRelations = relations(ruleVersion, ({one, many}) => ({
	aiExtractions: many(aiExtraction),
	approvals: many(approval),
	commands: many(command),
	deadlines: many(deadline),
	expenseAllocations: many(expenseAllocation),
	meterConsumptions: many(meterConsumption),
	provisionRegularizationRuns: many(provisionRegularizationRun),
	rentRevisions: many(rentRevision),
	rentTermVersions: many(rentTermVersion),
	appUser: one(appUser, {
		fields: [ruleVersion.approvedBy],
		references: [appUser.id]
	}),
	organization: one(organization, {
		fields: [ruleVersion.organizationId],
		references: [organization.id]
	}),
	rule: one(rule, {
		fields: [ruleVersion.ruleId],
		references: [rule.id]
	}),
}));

export const activityRelations = relations(activity, ({one, many}) => ({
	aiExtractions: many(aiExtraction),
	person: one(person, {
		fields: [activity.authorPersonId],
		references: [person.id]
	}),
	appUser: one(appUser, {
		fields: [activity.authorUserId],
		references: [appUser.id]
	}),
	organization: one(organization, {
		fields: [activity.organizationId],
		references: [organization.id]
	}),
	activityLinks: many(activityLink),
	events: many(event),
	inboxItems: many(inboxItem),
}));

export const documentVersionRelations = relations(documentVersion, ({one, many}) => ({
	aiExtractions: many(aiExtraction),
	documents: many(document, {
		relationName: "document_currentVersionId_documentVersion_id"
	}),
	appUser: one(appUser, {
		fields: [documentVersion.capturedByUserId],
		references: [appUser.id]
	}),
	documentVersion: one(documentVersion, {
		fields: [documentVersion.derivedFromVersionId],
		references: [documentVersion.id],
		relationName: "documentVersion_derivedFromVersionId_documentVersion_id"
	}),
	documentVersions: many(documentVersion, {
		relationName: "documentVersion_derivedFromVersionId_documentVersion_id"
	}),
	document: one(document, {
		fields: [documentVersion.documentId],
		references: [document.id],
		relationName: "documentVersion_documentId_document_id"
	}),
	organization: one(organization, {
		fields: [documentVersion.organizationId],
		references: [organization.id]
	}),
}));

export const objectRefRelations = relations(objectRef, ({one, many}) => ({
	aiExtractions: many(aiExtraction),
	auditLogs: many(auditLog),
	approvals: many(approval),
	activityLinks: many(activityLink),
	commands: many(command),
	deadlineLinks: many(deadlineLink),
	documentLinks: many(documentLink),
	embeddings: many(embedding),
	events: many(event),
	eventLinks: many(eventLink),
	externalRefs: many(externalRef),
	inboxItems: many(inboxItem),
	messageOutbounds: many(messageOutbound),
	bankAccount: one(bankAccount, {
		fields: [objectRef.organizationId],
		references: [bankAccount.id]
	}),
	booking: one(booking, {
		fields: [objectRef.organizationId],
		references: [booking.id]
	}),
	building: one(building, {
		fields: [objectRef.organizationId],
		references: [building.id]
	}),
	claim: one(claim, {
		fields: [objectRef.organizationId],
		references: [claim.id]
	}),
	depositAccount: one(depositAccount, {
		fields: [objectRef.organizationId],
		references: [depositAccount.id]
	}),
	document: one(document, {
		fields: [objectRef.organizationId],
		references: [document.id]
	}),
	equipment: one(equipment, {
		fields: [objectRef.organizationId],
		references: [equipment.id]
	}),
	expense: one(expense, {
		fields: [objectRef.organizationId],
		references: [expense.id]
	}),
	fixedAsset: one(fixedAsset, {
		fields: [objectRef.organizationId],
		references: [fixedAsset.id]
	}),
	organization: one(organization, {
		fields: [objectRef.organizationId],
		references: [organization.id]
	}),
	inspection: one(inspection, {
		fields: [objectRef.organizationId],
		references: [inspection.id]
	}),
	insurancePolicy: one(insurancePolicy, {
		fields: [objectRef.organizationId],
		references: [insurancePolicy.id]
	}),
	intervention: one(intervention, {
		fields: [objectRef.organizationId],
		references: [intervention.id]
	}),
	lease: one(lease, {
		fields: [objectRef.organizationId],
		references: [lease.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [objectRef.organizationId],
		references: [legalEntity.id]
	}),
	listing: one(listing, {
		fields: [objectRef.organizationId],
		references: [listing.id]
	}),
	loan: one(loan, {
		fields: [objectRef.organizationId],
		references: [loan.id]
	}),
	meter: one(meter, {
		fields: [objectRef.organizationId],
		references: [meter.id]
	}),
	partnerCurrentAccount: one(partnerCurrentAccount, {
		fields: [objectRef.organizationId],
		references: [partnerCurrentAccount.id]
	}),
	payment: one(payment, {
		fields: [objectRef.organizationId],
		references: [payment.id]
	}),
	person: one(person, {
		fields: [objectRef.organizationId],
		references: [person.id]
	}),
	rentTerm: one(rentTerm, {
		fields: [objectRef.organizationId],
		references: [rentTerm.id]
	}),
	supplier: one(supplier, {
		fields: [objectRef.organizationId],
		references: [supplier.id]
	}),
	unit: one(unit, {
		fields: [objectRef.organizationId],
		references: [unit.id]
	}),
	worksProject: one(worksProject, {
		fields: [objectRef.organizationId],
		references: [worksProject.id]
	}),
	searchDocuments: many(searchDocument),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	appUser: one(appUser, {
		fields: [auditLog.actorUserId],
		references: [appUser.id]
	}),
	approval: one(approval, {
		fields: [auditLog.approvalId],
		references: [approval.id]
	}),
	objectRef: one(objectRef, {
		fields: [auditLog.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [auditLog.organizationId],
		references: [organization.id]
	}),
}));

export const approvalRelations = relations(approval, ({one, many}) => ({
	auditLogs: many(auditLog),
	appUser: one(appUser, {
		fields: [approval.approverUserId],
		references: [appUser.id]
	}),
	command: one(command, {
		fields: [approval.commandId],
		references: [command.id],
		relationName: "approval_commandId_command_id"
	}),
	objectRef: one(objectRef, {
		fields: [approval.evidenceObjectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [approval.organizationId],
		references: [organization.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [approval.ruleVersionId],
		references: [ruleVersion.id]
	}),
	ccaMovements: many(ccaMovement),
	commands: many(command, {
		relationName: "command_approvalId_approval_id"
	}),
	depositMovements: many(depositMovement),
	inspectionFindings: many(inspectionFinding),
	messageOutbounds: many(messageOutbound),
	provisionRegularizationRuns: many(provisionRegularizationRun),
	rentRevisions: many(rentRevision),
}));

export const commandRelations = relations(command, ({one, many}) => ({
	approvals: many(approval, {
		relationName: "approval_commandId_command_id"
	}),
	acquisitionOpportunities: many(acquisitionOpportunity),
	appUser: one(appUser, {
		fields: [command.actorUserId],
		references: [appUser.id]
	}),
	approval: one(approval, {
		fields: [command.approvalId],
		references: [approval.id],
		relationName: "command_approvalId_approval_id"
	}),
	externalRef: one(externalRef, {
		fields: [command.externalRefId],
		references: [externalRef.id]
	}),
	organization: one(organization, {
		fields: [command.organizationId],
		references: [organization.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [command.ruleVersionId],
		references: [ruleVersion.id]
	}),
	objectRef: one(objectRef, {
		fields: [command.targetObjectRefId],
		references: [objectRef.id]
	}),
	commandAttempts: many(commandAttempt),
	outboxEntries: many(outboxEntry),
	integrationExchanges: many(integrationExchange),
}));

export const assetComponentRelations = relations(assetComponent, ({one, many}) => ({
	equipment: one(equipment, {
		fields: [assetComponent.equipmentId],
		references: [equipment.id]
	}),
	fixedAsset: one(fixedAsset, {
		fields: [assetComponent.fixedAssetId],
		references: [fixedAsset.id]
	}),
	organization: one(organization, {
		fields: [assetComponent.organizationId],
		references: [organization.id]
	}),
	assetComponent: one(assetComponent, {
		fields: [assetComponent.replacedComponentId],
		references: [assetComponent.id],
		relationName: "assetComponent_replacedComponentId_assetComponent_id"
	}),
	assetComponents: many(assetComponent, {
		relationName: "assetComponent_replacedComponentId_assetComponent_id"
	}),
}));

export const equipmentRelations = relations(equipment, ({one, many}) => ({
	assetComponents: many(assetComponent),
	fixedAsset: one(fixedAsset, {
		fields: [equipment.fixedAssetId],
		references: [fixedAsset.id]
	}),
	organization: one(organization, {
		fields: [equipment.organizationId],
		references: [organization.id]
	}),
	supplier: one(supplier, {
		fields: [equipment.supplierId],
		references: [supplier.id]
	}),
	equipmentAssignments: many(equipmentAssignment),
	inspectionFindings: many(inspectionFinding),
	interventions: many(intervention),
	inventoryItems: many(inventoryItem),
	objectRefs: many(objectRef),
	policyScopes: many(policyScope),
}));

export const fixedAssetRelations = relations(fixedAsset, ({one, many}) => ({
	assetComponents: many(assetComponent),
	equipment: many(equipment),
	building: one(building, {
		fields: [fixedAsset.buildingId],
		references: [building.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [fixedAsset.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [fixedAsset.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [fixedAsset.unitId],
		references: [unit.id]
	}),
	objectRefs: many(objectRef),
}));

export const acquisitionOpportunityRelations = relations(acquisitionOpportunity, ({one, many}) => ({
	command: one(command, {
		fields: [acquisitionOpportunity.conversionCommandId],
		references: [command.id]
	}),
	building: one(building, {
		fields: [acquisitionOpportunity.convertedBuildingId],
		references: [building.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [acquisitionOpportunity.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [acquisitionOpportunity.organizationId],
		references: [organization.id]
	}),
	acquisitionScenarios: many(acquisitionScenario),
}));

export const acquisitionScenarioRelations = relations(acquisitionScenario, ({one}) => ({
	acquisitionOpportunity: one(acquisitionOpportunity, {
		fields: [acquisitionScenario.opportunityId],
		references: [acquisitionOpportunity.id]
	}),
	organization: one(organization, {
		fields: [acquisitionScenario.organizationId],
		references: [organization.id]
	}),
}));

export const activityLinkRelations = relations(activityLink, ({one}) => ({
	activity: one(activity, {
		fields: [activityLink.activityId],
		references: [activity.id]
	}),
	objectRef: one(objectRef, {
		fields: [activityLink.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [activityLink.organizationId],
		references: [organization.id]
	}),
}));

export const bankTransactionRelations = relations(bankTransaction, ({one, many}) => ({
	bankAccount: one(bankAccount, {
		fields: [bankTransaction.bankAccountId],
		references: [bankAccount.id]
	}),
	organization: one(organization, {
		fields: [bankTransaction.organizationId],
		references: [organization.id]
	}),
	ccaMovements: many(ccaMovement),
	internalTransfers_sourceTransactionId: many(internalTransfer, {
		relationName: "internalTransfer_sourceTransactionId_bankTransaction_id"
	}),
	internalTransfers_targetTransactionId: many(internalTransfer, {
		relationName: "internalTransfer_targetTransactionId_bankTransaction_id"
	}),
	loanInstallments: many(loanInstallment),
	payments: many(payment),
	payouts: many(payout),
}));

export const bookingRelations = relations(booking, ({one, many}) => ({
	person: one(person, {
		fields: [booking.guestPersonId],
		references: [person.id]
	}),
	listing: one(listing, {
		fields: [booking.listingId],
		references: [listing.id]
	}),
	organization: one(organization, {
		fields: [booking.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [booking.unitId],
		references: [unit.id]
	}),
	bookingMovements: many(bookingMovement),
	objectRefs: many(objectRef),
	payoutDetails: many(payoutDetail),
}));

export const listingRelations = relations(listing, ({one, many}) => ({
	bookings: many(booking),
	organization: one(organization, {
		fields: [listing.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [listing.unitId],
		references: [unit.id]
	}),
	objectRefs: many(objectRef),
}));

export const bookingMovementRelations = relations(bookingMovement, ({one, many}) => ({
	booking: one(booking, {
		fields: [bookingMovement.bookingId],
		references: [booking.id]
	}),
	organization: one(organization, {
		fields: [bookingMovement.organizationId],
		references: [organization.id]
	}),
	payoutDetails: many(payoutDetail),
}));

export const ccaMovementRelations = relations(ccaMovement, ({one}) => ({
	approval: one(approval, {
		fields: [ccaMovement.approvalId],
		references: [approval.id]
	}),
	bankTransaction: one(bankTransaction, {
		fields: [ccaMovement.bankTransactionId],
		references: [bankTransaction.id]
	}),
	partnerCurrentAccount: one(partnerCurrentAccount, {
		fields: [ccaMovement.ccaId],
		references: [partnerCurrentAccount.id]
	}),
	expense: one(expense, {
		fields: [ccaMovement.expenseId],
		references: [expense.id]
	}),
	organization: one(organization, {
		fields: [ccaMovement.organizationId],
		references: [organization.id]
	}),
	payment: one(payment, {
		fields: [ccaMovement.paymentId],
		references: [payment.id]
	}),
}));

export const partnerCurrentAccountRelations = relations(partnerCurrentAccount, ({one, many}) => ({
	ccaMovements: many(ccaMovement),
	objectRefs: many(objectRef),
	document: one(document, {
		fields: [partnerCurrentAccount.agreementDocumentId],
		references: [document.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [partnerCurrentAccount.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [partnerCurrentAccount.organizationId],
		references: [organization.id]
	}),
	person: one(person, {
		fields: [partnerCurrentAccount.partnerPersonId],
		references: [person.id]
	}),
}));

export const expenseRelations = relations(expense, ({one, many}) => ({
	ccaMovements: many(ccaMovement),
	expense_creditNoteOfExpenseId: one(expense, {
		fields: [expense.creditNoteOfExpenseId],
		references: [expense.id],
		relationName: "expense_creditNoteOfExpenseId_expense_id"
	}),
	expenses_creditNoteOfExpenseId: many(expense, {
		relationName: "expense_creditNoteOfExpenseId_expense_id"
	}),
	expense_duplicateOfExpenseId: one(expense, {
		fields: [expense.duplicateOfExpenseId],
		references: [expense.id],
		relationName: "expense_duplicateOfExpenseId_expense_id"
	}),
	expenses_duplicateOfExpenseId: many(expense, {
		relationName: "expense_duplicateOfExpenseId_expense_id"
	}),
	intervention: one(intervention, {
		fields: [expense.interventionId],
		references: [intervention.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [expense.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [expense.organizationId],
		references: [organization.id]
	}),
	person: one(person, {
		fields: [expense.paidByPersonId],
		references: [person.id]
	}),
	supplier: one(supplier, {
		fields: [expense.supplierId],
		references: [supplier.id]
	}),
	worksProject: one(worksProject, {
		fields: [expense.worksProjectId],
		references: [worksProject.id]
	}),
	expenseLines: many(expenseLine),
	internalTransfers: many(internalTransfer),
	objectRefs: many(objectRef),
}));

export const paymentRelations = relations(payment, ({one, many}) => ({
	ccaMovements: many(ccaMovement),
	claimIndemnities: many(claimIndemnity),
	depositMovements: many(depositMovement),
	objectRefs: many(objectRef),
	bankTransaction: one(bankTransaction, {
		fields: [payment.bankTransactionId],
		references: [bankTransaction.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [payment.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [payment.organizationId],
		references: [organization.id]
	}),
	person: one(person, {
		fields: [payment.payerPersonId],
		references: [person.id]
	}),
	paymentAllocations: many(paymentAllocation),
}));

export const chargeAllocationKeyRelations = relations(chargeAllocationKey, ({one, many}) => ({
	building: one(building, {
		fields: [chargeAllocationKey.buildingId],
		references: [building.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [chargeAllocationKey.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [chargeAllocationKey.organizationId],
		references: [organization.id]
	}),
	chargeAllocationKeyVersions: many(chargeAllocationKeyVersion),
}));

export const chargeAllocationKeyVersionRelations = relations(chargeAllocationKeyVersion, ({one, many}) => ({
	chargeAllocationKey: one(chargeAllocationKey, {
		fields: [chargeAllocationKeyVersion.allocationKeyId],
		references: [chargeAllocationKey.id]
	}),
	appUser: one(appUser, {
		fields: [chargeAllocationKeyVersion.approvedBy],
		references: [appUser.id]
	}),
	organization: one(organization, {
		fields: [chargeAllocationKeyVersion.organizationId],
		references: [organization.id]
	}),
	chargeAllocationShares: many(chargeAllocationShare),
	expenseAllocations: many(expenseAllocation),
	expenseLines: many(expenseLine),
}));

export const chargeAllocationShareRelations = relations(chargeAllocationShare, ({one}) => ({
	building: one(building, {
		fields: [chargeAllocationShare.buildingId],
		references: [building.id]
	}),
	chargeAllocationKeyVersion: one(chargeAllocationKeyVersion, {
		fields: [chargeAllocationShare.keyVersionId],
		references: [chargeAllocationKeyVersion.id]
	}),
	organization: one(organization, {
		fields: [chargeAllocationShare.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [chargeAllocationShare.unitId],
		references: [unit.id]
	}),
}));

export const claimRelations = relations(claim, ({one, many}) => ({
	building: one(building, {
		fields: [claim.buildingId],
		references: [building.id]
	}),
	lease: one(lease, {
		fields: [claim.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [claim.organizationId],
		references: [organization.id]
	}),
	insurancePolicy: one(insurancePolicy, {
		fields: [claim.policyId],
		references: [insurancePolicy.id]
	}),
	unit: one(unit, {
		fields: [claim.unitId],
		references: [unit.id]
	}),
	claimIndemnities: many(claimIndemnity),
	interventions: many(intervention),
	objectRefs: many(objectRef),
}));

export const leaseRelations = relations(lease, ({one, many}) => ({
	claims: many(claim),
	depositAccounts: many(depositAccount),
	guarantees: many(guarantee),
	inspections: many(inspection),
	interventions: many(intervention),
	inventoryItems: many(inventoryItem),
	legalEntity: one(legalEntity, {
		fields: [lease.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [lease.organizationId],
		references: [organization.id]
	}),
	lease: one(lease, {
		fields: [lease.previousLeaseId],
		references: [lease.id],
		relationName: "lease_previousLeaseId_lease_id"
	}),
	leases: many(lease, {
		relationName: "lease_previousLeaseId_lease_id"
	}),
	leaseParties: many(leaseParty),
	leaseUnits: many(leaseUnit),
	leaseVersions: many(leaseVersion),
	objectRefs: many(objectRef),
	rentTerms: many(rentTerm),
	policyScopes: many(policyScope),
	provisionRegularizationLines: many(provisionRegularizationLine),
	rentReceipts: many(rentReceipt),
	rentRevisions: many(rentRevision),
}));

export const insurancePolicyRelations = relations(insurancePolicy, ({one, many}) => ({
	claims: many(claim),
	document_lastCertificateDocumentId: one(document, {
		fields: [insurancePolicy.lastCertificateDocumentId],
		references: [document.id],
		relationName: "insurancePolicy_lastCertificateDocumentId_document_id"
	}),
	document_contractDocumentId: one(document, {
		fields: [insurancePolicy.contractDocumentId],
		references: [document.id],
		relationName: "insurancePolicy_contractDocumentId_document_id"
	}),
	person: one(person, {
		fields: [insurancePolicy.insuredPersonId],
		references: [person.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [insurancePolicy.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [insurancePolicy.organizationId],
		references: [organization.id]
	}),
	objectRefs: many(objectRef),
	policyScopes: many(policyScope),
}));

export const claimIndemnityRelations = relations(claimIndemnity, ({one}) => ({
	claim: one(claim, {
		fields: [claimIndemnity.claimId],
		references: [claim.id]
	}),
	organization: one(organization, {
		fields: [claimIndemnity.organizationId],
		references: [organization.id]
	}),
	payment: one(payment, {
		fields: [claimIndemnity.paymentId],
		references: [payment.id]
	}),
}));

export const externalRefRelations = relations(externalRef, ({one, many}) => ({
	commands: many(command),
	objectRef: one(objectRef, {
		fields: [externalRef.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [externalRef.organizationId],
		references: [organization.id]
	}),
}));

export const commandAttemptRelations = relations(commandAttempt, ({one}) => ({
	command: one(command, {
		fields: [commandAttempt.commandId],
		references: [command.id]
	}),
	organization: one(organization, {
		fields: [commandAttempt.organizationId],
		references: [organization.id]
	}),
}));

export const deadlineRelations = relations(deadline, ({one, many}) => ({
	appUser: one(appUser, {
		fields: [deadline.assigneeUserId],
		references: [appUser.id]
	}),
	event: one(event, {
		fields: [deadline.completedEventId],
		references: [event.id]
	}),
	organization: one(organization, {
		fields: [deadline.organizationId],
		references: [organization.id]
	}),
	deadline: one(deadline, {
		fields: [deadline.parentDeadlineId],
		references: [deadline.id],
		relationName: "deadline_parentDeadlineId_deadline_id"
	}),
	deadlines: many(deadline, {
		relationName: "deadline_parentDeadlineId_deadline_id"
	}),
	ruleVersion: one(ruleVersion, {
		fields: [deadline.ruleVersionId],
		references: [ruleVersion.id]
	}),
	deadlineLinks: many(deadlineLink),
}));

export const eventRelations = relations(event, ({one, many}) => ({
	deadlines: many(deadline),
	appUser: one(appUser, {
		fields: [event.actorUserId],
		references: [appUser.id]
	}),
	organization: one(organization, {
		fields: [event.organizationId],
		references: [organization.id]
	}),
	objectRef: one(objectRef, {
		fields: [event.primaryObjectRefId],
		references: [objectRef.id]
	}),
	activity: one(activity, {
		fields: [event.sourceActivityId],
		references: [activity.id]
	}),
	eventLinks: many(eventLink),
}));

export const deadlineLinkRelations = relations(deadlineLink, ({one}) => ({
	deadline: one(deadline, {
		fields: [deadlineLink.deadlineId],
		references: [deadline.id]
	}),
	objectRef: one(objectRef, {
		fields: [deadlineLink.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [deadlineLink.organizationId],
		references: [organization.id]
	}),
}));

export const depositAccountRelations = relations(depositAccount, ({one, many}) => ({
	lease: one(lease, {
		fields: [depositAccount.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [depositAccount.organizationId],
		references: [organization.id]
	}),
	depositMovements: many(depositMovement),
	objectRefs: many(objectRef),
	paymentAllocations: many(paymentAllocation),
}));

export const depositMovementRelations = relations(depositMovement, ({one}) => ({
	approval: one(approval, {
		fields: [depositMovement.approvalId],
		references: [approval.id]
	}),
	depositAccount: one(depositAccount, {
		fields: [depositMovement.depositAccountId],
		references: [depositAccount.id]
	}),
	document: one(document, {
		fields: [depositMovement.justificationDocumentId],
		references: [document.id]
	}),
	rentTerm: one(rentTerm, {
		fields: [depositMovement.offsetRentTermId],
		references: [rentTerm.id]
	}),
	organization: one(organization, {
		fields: [depositMovement.organizationId],
		references: [organization.id]
	}),
	payment: one(payment, {
		fields: [depositMovement.paymentId],
		references: [payment.id]
	}),
}));

export const rentTermRelations = relations(rentTerm, ({one, many}) => ({
	depositMovements: many(depositMovement),
	objectRefs: many(objectRef),
	paymentAllocations: many(paymentAllocation),
	rentTerm: one(rentTerm, {
		fields: [rentTerm.adjustsRentTermId],
		references: [rentTerm.id],
		relationName: "rentTerm_adjustsRentTermId_rentTerm_id"
	}),
	rentTerms: many(rentTerm, {
		relationName: "rentTerm_adjustsRentTermId_rentTerm_id"
	}),
	rentTermVersion: one(rentTermVersion, {
		fields: [rentTerm.currentVersionId],
		references: [rentTermVersion.id],
		relationName: "rentTerm_currentVersionId_rentTermVersion_id"
	}),
	lease: one(lease, {
		fields: [rentTerm.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [rentTerm.organizationId],
		references: [organization.id]
	}),
	provisionRegularizationRun: one(provisionRegularizationRun, {
		fields: [rentTerm.regularizationRunId],
		references: [provisionRegularizationRun.id]
	}),
	provisionRegularizationLines: many(provisionRegularizationLine),
	rentTermVersions: many(rentTermVersion, {
		relationName: "rentTermVersion_rentTermId_rentTerm_id"
	}),
}));

export const documentLinkRelations = relations(documentLink, ({one}) => ({
	document: one(document, {
		fields: [documentLink.documentId],
		references: [document.id]
	}),
	objectRef: one(objectRef, {
		fields: [documentLink.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [documentLink.organizationId],
		references: [organization.id]
	}),
}));

export const embeddingRelations = relations(embedding, ({one}) => ({
	objectRef: one(objectRef, {
		fields: [embedding.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [embedding.organizationId],
		references: [organization.id]
	}),
}));

export const supplierRelations = relations(supplier, ({one, many}) => ({
	equipment: many(equipment),
	expenses: many(expense),
	interventions: many(intervention),
	objectRefs: many(objectRef),
	organization: one(organization, {
		fields: [supplier.organizationId],
		references: [organization.id]
	}),
	appUser: one(appUser, {
		fields: [supplier.paymentIdentityValidatedBy],
		references: [appUser.id]
	}),
	person: one(person, {
		fields: [supplier.personId],
		references: [person.id]
	}),
}));

export const equipmentAssignmentRelations = relations(equipmentAssignment, ({one}) => ({
	building: one(building, {
		fields: [equipmentAssignment.buildingId],
		references: [building.id]
	}),
	equipment: one(equipment, {
		fields: [equipmentAssignment.equipmentId],
		references: [equipment.id]
	}),
	organization: one(organization, {
		fields: [equipmentAssignment.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [equipmentAssignment.unitId],
		references: [unit.id]
	}),
}));

export const eventLinkRelations = relations(eventLink, ({one}) => ({
	event: one(event, {
		fields: [eventLink.eventId],
		references: [event.id]
	}),
	objectRef: one(objectRef, {
		fields: [eventLink.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [eventLink.organizationId],
		references: [organization.id]
	}),
}));

export const interventionRelations = relations(intervention, ({one, many}) => ({
	expenses: many(expense),
	building: one(building, {
		fields: [intervention.buildingId],
		references: [building.id]
	}),
	claim: one(claim, {
		fields: [intervention.claimId],
		references: [claim.id]
	}),
	equipment: one(equipment, {
		fields: [intervention.equipmentId],
		references: [equipment.id]
	}),
	lease: one(lease, {
		fields: [intervention.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [intervention.organizationId],
		references: [organization.id]
	}),
	supplier: one(supplier, {
		fields: [intervention.supplierId],
		references: [supplier.id]
	}),
	unit: one(unit, {
		fields: [intervention.unitId],
		references: [unit.id]
	}),
	worksProject: one(worksProject, {
		fields: [intervention.worksProjectId],
		references: [worksProject.id]
	}),
	objectRefs: many(objectRef),
}));

export const worksProjectRelations = relations(worksProject, ({one, many}) => ({
	expenses: many(expense),
	interventions: many(intervention),
	objectRefs: many(objectRef),
	building: one(building, {
		fields: [worksProject.buildingId],
		references: [building.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [worksProject.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [worksProject.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [worksProject.unitId],
		references: [unit.id]
	}),
}));

export const expenseAllocationRelations = relations(expenseAllocation, ({one}) => ({
	aiExtraction: one(aiExtraction, {
		fields: [expenseAllocation.aiExtractionId],
		references: [aiExtraction.id]
	}),
	building: one(building, {
		fields: [expenseAllocation.buildingId],
		references: [building.id]
	}),
	expenseLine: one(expenseLine, {
		fields: [expenseAllocation.expenseLineId],
		references: [expenseLine.id]
	}),
	chargeAllocationKeyVersion: one(chargeAllocationKeyVersion, {
		fields: [expenseAllocation.keyVersionId],
		references: [chargeAllocationKeyVersion.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [expenseAllocation.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [expenseAllocation.organizationId],
		references: [organization.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [expenseAllocation.ruleVersionId],
		references: [ruleVersion.id]
	}),
	unit: one(unit, {
		fields: [expenseAllocation.unitId],
		references: [unit.id]
	}),
}));

export const expenseLineRelations = relations(expenseLine, ({one, many}) => ({
	expenseAllocations: many(expenseAllocation),
	expense: one(expense, {
		fields: [expenseLine.expenseId],
		references: [expense.id]
	}),
	chargeAllocationKeyVersion: one(chargeAllocationKeyVersion, {
		fields: [expenseLine.allocationKeyVersionId],
		references: [chargeAllocationKeyVersion.id]
	}),
	organization: one(organization, {
		fields: [expenseLine.organizationId],
		references: [organization.id]
	}),
}));

export const guaranteeRelations = relations(guarantee, ({one}) => ({
	legalEntity: one(legalEntity, {
		fields: [guarantee.beneficiaryLegalEntityId],
		references: [legalEntity.id]
	}),
	document: one(document, {
		fields: [guarantee.signedDocumentId],
		references: [document.id]
	}),
	person: one(person, {
		fields: [guarantee.guarantorPersonId],
		references: [person.id]
	}),
	lease: one(lease, {
		fields: [guarantee.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [guarantee.organizationId],
		references: [organization.id]
	}),
}));

export const inspectionRelations = relations(inspection, ({one, many}) => ({
	document: one(document, {
		fields: [inspection.signedDocumentId],
		references: [document.id]
	}),
	lease: one(lease, {
		fields: [inspection.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [inspection.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [inspection.unitId],
		references: [unit.id]
	}),
	inspectionFindings: many(inspectionFinding),
	meterReadings: many(meterReading),
	objectRefs: many(objectRef),
}));

export const inspectionFindingRelations = relations(inspectionFinding, ({one, many}) => ({
	approval: one(approval, {
		fields: [inspectionFinding.decisionApprovalId],
		references: [approval.id]
	}),
	inspectionFinding: one(inspectionFinding, {
		fields: [inspectionFinding.entryFindingId],
		references: [inspectionFinding.id],
		relationName: "inspectionFinding_entryFindingId_inspectionFinding_id"
	}),
	inspectionFindings: many(inspectionFinding, {
		relationName: "inspectionFinding_entryFindingId_inspectionFinding_id"
	}),
	equipment: one(equipment, {
		fields: [inspectionFinding.equipmentId],
		references: [equipment.id]
	}),
	inspection: one(inspection, {
		fields: [inspectionFinding.inspectionId],
		references: [inspection.id]
	}),
	organization: one(organization, {
		fields: [inspectionFinding.organizationId],
		references: [organization.id]
	}),
}));

export const integrationCursorRelations = relations(integrationCursor, ({one}) => ({
	organization: one(organization, {
		fields: [integrationCursor.organizationId],
		references: [organization.id]
	}),
}));

export const internalTransferRelations = relations(internalTransfer, ({one}) => ({
	expense: one(expense, {
		fields: [internalTransfer.feeExpenseId],
		references: [expense.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [internalTransfer.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [internalTransfer.organizationId],
		references: [organization.id]
	}),
	bankAccount_sourceBankAccountId: one(bankAccount, {
		fields: [internalTransfer.sourceBankAccountId],
		references: [bankAccount.id],
		relationName: "internalTransfer_sourceBankAccountId_bankAccount_id"
	}),
	bankTransaction_sourceTransactionId: one(bankTransaction, {
		fields: [internalTransfer.sourceTransactionId],
		references: [bankTransaction.id],
		relationName: "internalTransfer_sourceTransactionId_bankTransaction_id"
	}),
	bankAccount_targetBankAccountId: one(bankAccount, {
		fields: [internalTransfer.targetBankAccountId],
		references: [bankAccount.id],
		relationName: "internalTransfer_targetBankAccountId_bankAccount_id"
	}),
	bankTransaction_targetTransactionId: one(bankTransaction, {
		fields: [internalTransfer.targetTransactionId],
		references: [bankTransaction.id],
		relationName: "internalTransfer_targetTransactionId_bankTransaction_id"
	}),
}));

export const inventoryItemRelations = relations(inventoryItem, ({one}) => ({
	equipment: one(equipment, {
		fields: [inventoryItem.equipmentId],
		references: [equipment.id]
	}),
	lease: one(lease, {
		fields: [inventoryItem.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [inventoryItem.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [inventoryItem.unitId],
		references: [unit.id]
	}),
}));

export const leasePartyRelations = relations(leaseParty, ({one}) => ({
	lease: one(lease, {
		fields: [leaseParty.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [leaseParty.organizationId],
		references: [organization.id]
	}),
	person: one(person, {
		fields: [leaseParty.personId],
		references: [person.id]
	}),
}));

export const leaseUnitRelations = relations(leaseUnit, ({one}) => ({
	lease: one(lease, {
		fields: [leaseUnit.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [leaseUnit.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [leaseUnit.unitId],
		references: [unit.id]
	}),
}));

export const loanRelations = relations(loan, ({one, many}) => ({
	bankAccount: one(bankAccount, {
		fields: [loan.bankAccountId],
		references: [bankAccount.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [loan.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [loan.organizationId],
		references: [organization.id]
	}),
	loanProperties: many(loanProperty),
	loanScheduleVersions: many(loanScheduleVersion),
	objectRefs: many(objectRef),
	policyScopes: many(policyScope),
}));

export const leaseVersionRelations = relations(leaseVersion, ({one, many}) => ({
	document: one(document, {
		fields: [leaseVersion.signedDocumentId],
		references: [document.id]
	}),
	lease: one(lease, {
		fields: [leaseVersion.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [leaseVersion.organizationId],
		references: [organization.id]
	}),
	rentTermVersions: many(rentTermVersion),
}));

export const loanInstallmentRelations = relations(loanInstallment, ({one}) => ({
	bankTransaction: one(bankTransaction, {
		fields: [loanInstallment.bankTransactionId],
		references: [bankTransaction.id]
	}),
	organization: one(organization, {
		fields: [loanInstallment.organizationId],
		references: [organization.id]
	}),
	loanScheduleVersion: one(loanScheduleVersion, {
		fields: [loanInstallment.scheduleVersionId],
		references: [loanScheduleVersion.id]
	}),
}));

export const loanScheduleVersionRelations = relations(loanScheduleVersion, ({one, many}) => ({
	loanInstallments: many(loanInstallment),
	document: one(document, {
		fields: [loanScheduleVersion.sourceDocumentId],
		references: [document.id]
	}),
	loan: one(loan, {
		fields: [loanScheduleVersion.loanId],
		references: [loan.id]
	}),
	organization: one(organization, {
		fields: [loanScheduleVersion.organizationId],
		references: [organization.id]
	}),
}));

export const outboxEntryRelations = relations(outboxEntry, ({one}) => ({
	command: one(command, {
		fields: [outboxEntry.commandId],
		references: [command.id]
	}),
	messageOutbound: one(messageOutbound, {
		fields: [outboxEntry.messageOutboundId],
		references: [messageOutbound.id]
	}),
	organization: one(organization, {
		fields: [outboxEntry.organizationId],
		references: [organization.id]
	}),
}));

export const messageOutboundRelations = relations(messageOutbound, ({one, many}) => ({
	outboxEntries: many(outboxEntry),
	approval: one(approval, {
		fields: [messageOutbound.approvalId],
		references: [approval.id]
	}),
	organization: one(organization, {
		fields: [messageOutbound.organizationId],
		references: [organization.id]
	}),
	contactPoint: one(contactPoint, {
		fields: [messageOutbound.recipientContactPointId],
		references: [contactPoint.id]
	}),
	person: one(person, {
		fields: [messageOutbound.recipientPersonId],
		references: [person.id]
	}),
	objectRef: one(objectRef, {
		fields: [messageOutbound.relatedObjectRefId],
		references: [objectRef.id]
	}),
}));

export const loanPropertyRelations = relations(loanProperty, ({one}) => ({
	building: one(building, {
		fields: [loanProperty.buildingId],
		references: [building.id]
	}),
	loan: one(loan, {
		fields: [loanProperty.loanId],
		references: [loan.id]
	}),
	organization: one(organization, {
		fields: [loanProperty.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [loanProperty.unitId],
		references: [unit.id]
	}),
}));

export const membershipRelations = relations(membership, ({one}) => ({
	appUser: one(appUser, {
		fields: [membership.appUserId],
		references: [appUser.id]
	}),
	organization: one(organization, {
		fields: [membership.organizationId],
		references: [organization.id]
	}),
}));

export const meterRelations = relations(meter, ({one, many}) => ({
	building: one(building, {
		fields: [meter.buildingId],
		references: [building.id]
	}),
	organization: one(organization, {
		fields: [meter.organizationId],
		references: [organization.id]
	}),
	meter: one(meter, {
		fields: [meter.replacedMeterId],
		references: [meter.id],
		relationName: "meter_replacedMeterId_meter_id"
	}),
	meters: many(meter, {
		relationName: "meter_replacedMeterId_meter_id"
	}),
	meterConsumptions: many(meterConsumption),
	meterReadings: many(meterReading),
	meterServicePeriods: many(meterServicePeriod),
	objectRefs: many(objectRef),
}));

export const meterConsumptionRelations = relations(meterConsumption, ({one}) => ({
	meterReading_fromReadingId: one(meterReading, {
		fields: [meterConsumption.fromReadingId],
		references: [meterReading.id],
		relationName: "meterConsumption_fromReadingId_meterReading_id"
	}),
	meter: one(meter, {
		fields: [meterConsumption.meterId],
		references: [meter.id]
	}),
	organization: one(organization, {
		fields: [meterConsumption.organizationId],
		references: [organization.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [meterConsumption.ruleVersionId],
		references: [ruleVersion.id]
	}),
	meterReading_toReadingId: one(meterReading, {
		fields: [meterConsumption.toReadingId],
		references: [meterReading.id],
		relationName: "meterConsumption_toReadingId_meterReading_id"
	}),
}));

export const meterReadingRelations = relations(meterReading, ({one, many}) => ({
	meterConsumptions_fromReadingId: many(meterConsumption, {
		relationName: "meterConsumption_fromReadingId_meterReading_id"
	}),
	meterConsumptions_toReadingId: many(meterConsumption, {
		relationName: "meterConsumption_toReadingId_meterReading_id"
	}),
	inspection: one(inspection, {
		fields: [meterReading.inspectionId],
		references: [inspection.id]
	}),
	meter: one(meter, {
		fields: [meterReading.meterId],
		references: [meter.id]
	}),
	organization: one(organization, {
		fields: [meterReading.organizationId],
		references: [organization.id]
	}),
	document: one(document, {
		fields: [meterReading.photoDocumentId],
		references: [document.id]
	}),
	appUser: one(appUser, {
		fields: [meterReading.validatedBy],
		references: [appUser.id]
	}),
}));

export const meterServicePeriodRelations = relations(meterServicePeriod, ({one}) => ({
	meter: one(meter, {
		fields: [meterServicePeriod.meterId],
		references: [meter.id]
	}),
	organization: one(organization, {
		fields: [meterServicePeriod.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [meterServicePeriod.unitId],
		references: [unit.id]
	}),
}));

export const paymentAllocationRelations = relations(paymentAllocation, ({one}) => ({
	depositAccount: one(depositAccount, {
		fields: [paymentAllocation.depositAccountId],
		references: [depositAccount.id]
	}),
	organization: one(organization, {
		fields: [paymentAllocation.organizationId],
		references: [organization.id]
	}),
	payment: one(payment, {
		fields: [paymentAllocation.paymentId],
		references: [payment.id]
	}),
	rentTerm: one(rentTerm, {
		fields: [paymentAllocation.rentTermId],
		references: [rentTerm.id]
	}),
}));

export const rentTermVersionRelations = relations(rentTermVersion, ({one, many}) => ({
	rentTerms: many(rentTerm, {
		relationName: "rentTerm_currentVersionId_rentTermVersion_id"
	}),
	leaseVersion: one(leaseVersion, {
		fields: [rentTermVersion.leaseVersionId],
		references: [leaseVersion.id]
	}),
	organization: one(organization, {
		fields: [rentTermVersion.organizationId],
		references: [organization.id]
	}),
	rentTerm: one(rentTerm, {
		fields: [rentTermVersion.rentTermId],
		references: [rentTerm.id],
		relationName: "rentTermVersion_rentTermId_rentTerm_id"
	}),
	ruleVersion: one(ruleVersion, {
		fields: [rentTermVersion.ruleVersionId],
		references: [ruleVersion.id]
	}),
}));

export const provisionRegularizationRunRelations = relations(provisionRegularizationRun, ({one, many}) => ({
	rentTerms: many(rentTerm),
	provisionRegularizationLines: many(provisionRegularizationLine),
	building: one(building, {
		fields: [provisionRegularizationRun.buildingId],
		references: [building.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [provisionRegularizationRun.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [provisionRegularizationRun.organizationId],
		references: [organization.id]
	}),
	approval: one(approval, {
		fields: [provisionRegularizationRun.approvalId],
		references: [approval.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [provisionRegularizationRun.ruleVersionId],
		references: [ruleVersion.id]
	}),
}));

export const payoutRelations = relations(payout, ({one, many}) => ({
	bankTransaction: one(bankTransaction, {
		fields: [payout.bankTransactionId],
		references: [bankTransaction.id]
	}),
	legalEntity: one(legalEntity, {
		fields: [payout.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [payout.organizationId],
		references: [organization.id]
	}),
	payoutDetails: many(payoutDetail),
}));

export const payoutDetailRelations = relations(payoutDetail, ({one}) => ({
	booking: one(booking, {
		fields: [payoutDetail.bookingId],
		references: [booking.id]
	}),
	bookingMovement: one(bookingMovement, {
		fields: [payoutDetail.bookingMovementId],
		references: [bookingMovement.id]
	}),
	organization: one(organization, {
		fields: [payoutDetail.organizationId],
		references: [organization.id]
	}),
	payout: one(payout, {
		fields: [payoutDetail.payoutId],
		references: [payout.id]
	}),
}));

export const personRoleRelations = relations(personRole, ({one}) => ({
	legalEntity: one(legalEntity, {
		fields: [personRole.legalEntityId],
		references: [legalEntity.id]
	}),
	organization: one(organization, {
		fields: [personRole.organizationId],
		references: [organization.id]
	}),
	person: one(person, {
		fields: [personRole.personId],
		references: [person.id]
	}),
}));

export const policyScopeRelations = relations(policyScope, ({one}) => ({
	building: one(building, {
		fields: [policyScope.buildingId],
		references: [building.id]
	}),
	equipment: one(equipment, {
		fields: [policyScope.equipmentId],
		references: [equipment.id]
	}),
	lease: one(lease, {
		fields: [policyScope.leaseId],
		references: [lease.id]
	}),
	loan: one(loan, {
		fields: [policyScope.loanId],
		references: [loan.id]
	}),
	organization: one(organization, {
		fields: [policyScope.organizationId],
		references: [organization.id]
	}),
	insurancePolicy: one(insurancePolicy, {
		fields: [policyScope.policyId],
		references: [insurancePolicy.id]
	}),
	unit: one(unit, {
		fields: [policyScope.unitId],
		references: [unit.id]
	}),
}));

export const provisionRegularizationLineRelations = relations(provisionRegularizationLine, ({one}) => ({
	lease: one(lease, {
		fields: [provisionRegularizationLine.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [provisionRegularizationLine.organizationId],
		references: [organization.id]
	}),
	rentTerm: one(rentTerm, {
		fields: [provisionRegularizationLine.resultingRentTermId],
		references: [rentTerm.id]
	}),
	provisionRegularizationRun: one(provisionRegularizationRun, {
		fields: [provisionRegularizationLine.runId],
		references: [provisionRegularizationRun.id]
	}),
	unit: one(unit, {
		fields: [provisionRegularizationLine.unitId],
		references: [unit.id]
	}),
}));

export const rentReceiptRelations = relations(rentReceipt, ({one}) => ({
	contactPoint: one(contactPoint, {
		fields: [rentReceipt.deliveryConsentContactPointId],
		references: [contactPoint.id]
	}),
	document: one(document, {
		fields: [rentReceipt.documentId],
		references: [document.id]
	}),
	lease: one(lease, {
		fields: [rentReceipt.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [rentReceipt.organizationId],
		references: [organization.id]
	}),
}));

export const rentRevisionRelations = relations(rentRevision, ({one}) => ({
	approval: one(approval, {
		fields: [rentRevision.approvalId],
		references: [approval.id]
	}),
	lease: one(lease, {
		fields: [rentRevision.leaseId],
		references: [lease.id]
	}),
	organization: one(organization, {
		fields: [rentRevision.organizationId],
		references: [organization.id]
	}),
	ruleVersion: one(ruleVersion, {
		fields: [rentRevision.ruleVersionId],
		references: [ruleVersion.id]
	}),
}));

export const ruleRelations = relations(rule, ({one, many}) => ({
	organization: one(organization, {
		fields: [rule.organizationId],
		references: [organization.id]
	}),
	ruleVersions: many(ruleVersion),
}));

export const searchDocumentRelations = relations(searchDocument, ({one}) => ({
	objectRef: one(objectRef, {
		fields: [searchDocument.objectRefId],
		references: [objectRef.id]
	}),
	organization: one(organization, {
		fields: [searchDocument.organizationId],
		references: [organization.id]
	}),
}));

export const unitLineageRelations = relations(unitLineage, ({one}) => ({
	organization: one(organization, {
		fields: [unitLineage.organizationId],
		references: [organization.id]
	}),
	unit_sourceUnitId: one(unit, {
		fields: [unitLineage.sourceUnitId],
		references: [unit.id],
		relationName: "unitLineage_sourceUnitId_unit_id"
	}),
	unit_targetUnitId: one(unit, {
		fields: [unitLineage.targetUnitId],
		references: [unit.id],
		relationName: "unitLineage_targetUnitId_unit_id"
	}),
}));

export const unitUsagePeriodRelations = relations(unitUsagePeriod, ({one}) => ({
	organization: one(organization, {
		fields: [unitUsagePeriod.organizationId],
		references: [organization.id]
	}),
	unit: one(unit, {
		fields: [unitUsagePeriod.unitId],
		references: [unit.id]
	}),
}));

export const authSessionRelations = relations(authSession, ({one}) => ({
	authUser: one(authUser, {
		fields: [authSession.userId],
		references: [authUser.id]
	}),
}));

export const authUserRelations = relations(authUser, ({many}) => ({
	authSessions: many(authSession),
	authAccounts: many(authAccount),
	authMembers: many(authMember),
	authInvitations: many(authInvitation),
	authTwoFactors: many(authTwoFactor),
}));

export const authAccountRelations = relations(authAccount, ({one}) => ({
	authUser: one(authUser, {
		fields: [authAccount.userId],
		references: [authUser.id]
	}),
}));

export const authMemberRelations = relations(authMember, ({one}) => ({
	authOrganization: one(authOrganization, {
		fields: [authMember.organizationId],
		references: [authOrganization.id]
	}),
	authUser: one(authUser, {
		fields: [authMember.userId],
		references: [authUser.id]
	}),
}));

export const authOrganizationRelations = relations(authOrganization, ({many}) => ({
	authMembers: many(authMember),
	authInvitations: many(authInvitation),
}));

export const authInvitationRelations = relations(authInvitation, ({one}) => ({
	authUser: one(authUser, {
		fields: [authInvitation.inviterId],
		references: [authUser.id]
	}),
	authOrganization: one(authOrganization, {
		fields: [authInvitation.organizationId],
		references: [authOrganization.id]
	}),
}));

export const authTwoFactorRelations = relations(authTwoFactor, ({one}) => ({
	authUser: one(authUser, {
		fields: [authTwoFactor.userId],
		references: [authUser.id]
	}),
}));

export const integrationExchangeRelations = relations(integrationExchange, ({one}) => ({
	command: one(command, {
		fields: [integrationExchange.commandId],
		references: [command.id]
	}),
	organization: one(organization, {
		fields: [integrationExchange.organizationId],
		references: [organization.id]
	}),
}));