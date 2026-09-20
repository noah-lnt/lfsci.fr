import "server-only";
import type {
  AcquisitionOpportunity,
  CreateAcquisitionOpportunityInput,
  CreateAcquisitionScenarioInput,
  UpdateAcquisitionOpportunityInput,
  UpdateAcquisitionScenarioInput,
} from "@lfsci/contracts";
import { decisionLevelByCommand } from "@lfsci/contracts";
import { createCommand, ensureObjectRef, hashPayload, type Tx, tables } from "@lfsci/db";
import { acquisitionOutcome } from "@lfsci/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  ConvertOpportunityInput,
  ConvertOpportunityResult,
  OpportunityDetail,
  OpportunityRow,
  ScenarioWithOutcome,
} from "@/lib/contracts/acquisitions";
import { type Actor, audit, recordFact } from "../finance/facts";
import {
  amount,
  amountOrNull,
  DEFAULT_LIMIT,
  firstOr,
  instant,
  instantOrNow,
  nextCursor,
  offsetFromCursor,
  ruleViolation,
  sumAmounts,
  versionConflict,
} from "../finance/shared";
import { planConversion } from "./plan";

type OpportunityRowDb = typeof tables.acquisitionOpportunity.$inferSelect;
type ScenarioRowDb = typeof tables.acquisitionScenario.$inferSelect;

function audited(row: { createdAt: string; updatedAt: string | null; version: number }) {
  return {
    createdAt: instantOrNow(row.createdAt),
    updatedAt: instant(row.updatedAt),
    version: row.version,
  };
}

function mapOpportunity(row: OpportunityRowDb): AcquisitionOpportunity {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    label: row.label,
    addressLine1: row.addressLine1,
    postalCode: row.postalCode,
    city: row.city,
    askingPrice: amountOrNull(row.askingPrice),
    estimatedFees: amountOrNull(row.estimatedFees),
    estimatedWorks: amountOrNull(row.estimatedWorks),
    expectedRentYearly: amountOrNull(row.expectedRentYearly),
    currency: row.currency,
    status: row.status as AcquisitionOpportunity["status"],
    signedOn: row.signedOn,
    convertedBuildingId: row.convertedBuildingId,
    conversionCommandId: row.conversionCommandId,
  };
}

function budgetOf(row: OpportunityRowDb): string {
  return sumAmounts([row.askingPrice, row.estimatedFees, row.estimatedWorks]);
}

type Assumptions = {
  chargesYearly?: string;
  loanRate?: string;
  loanMonths?: number;
  lender?: string;
  notes?: string;
};

function assumptionsOf(row: ScenarioRowDb): Assumptions {
  return (row.assumptions ?? {}) as Assumptions;
}

function mapScenario(row: ScenarioRowDb, opportunity: OpportunityRowDb): ScenarioWithOutcome {
  const assumptions = assumptionsOf(row);
  const chargesYearly = amount(assumptions.chargesYearly);
  const loanRate = assumptions.loanRate ?? "0";
  const loanMonths = assumptions.loanMonths ?? 0;
  return {
    id: row.id,
    ...audited(row),
    opportunityId: row.opportunityId,
    label: row.label,
    isBase: row.isBase,
    assumptions: assumptions as Record<string, unknown>,
    loanAmount: amountOrNull(row.loanAmount),
    equityAmount: amountOrNull(row.equityAmount),
    vacancyRate: row.vacancyRate,
    unpaidRate: row.unpaidRate,
    currency: row.currency,
    chargesYearly,
    loanRate,
    loanMonths,
    notes: assumptions.notes ?? null,
    outcome: acquisitionOutcome({
      price: amount(opportunity.askingPrice),
      fees: amount(opportunity.estimatedFees),
      works: amount(opportunity.estimatedWorks),
      equity: amount(row.equityAmount),
      loanAmount: amount(row.loanAmount),
      // The rate is entered as a percentage; the domain takes an annual fraction.
      loanAnnualRate: (Number(loanRate) / 100).toFixed(12),
      loanMonths,
      expectedRentYearly: amount(opportunity.expectedRentYearly),
      chargesYearly,
      ...(row.vacancyRate === null ? {} : { vacancyRate: row.vacancyRate }),
      ...(row.unpaidRate === null ? {} : { unpaidRate: row.unpaidRate }),
    }),
  };
}

async function documentCounts(tx: Tx, ids: readonly string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      buildingId: tables.objectRef.buildingId,
      total: sql<number>`count(*)::int`,
    })
    .from(tables.documentLink)
    .innerJoin(tables.objectRef, eq(tables.documentLink.objectRefId, tables.objectRef.id))
    .where(inArray(tables.objectRef.buildingId, ids))
    .groupBy(tables.objectRef.buildingId);
  return new Map(rows.map((row) => [row.buildingId as string, row.total]));
}

export async function listOpportunities(
  tx: Tx,
  input: { cursor?: string | undefined; limit?: number | undefined; status?: string | undefined },
): Promise<{ items: OpportunityRow[]; nextCursor: string | null }> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = offsetFromCursor(input.cursor);
  const rows = await tx
    .select()
    .from(tables.acquisitionOpportunity)
    .where(input.status ? eq(tables.acquisitionOpportunity.status, input.status) : undefined)
    .orderBy(desc(tables.acquisitionOpportunity.createdAt))
    .limit(limit + 1)
    .offset(offset);
  const page = rows.slice(0, limit);

  const scenarios =
    page.length === 0
      ? []
      : await tx
          .select()
          .from(tables.acquisitionScenario)
          .where(
            inArray(
              tables.acquisitionScenario.opportunityId,
              page.map((row) => row.id),
            ),
          );
  const documents = await documentCounts(
    tx,
    page.map((row) => row.convertedBuildingId).filter((id): id is string => id !== null),
  );

  return {
    items: page.map((row) => {
      const own = scenarios.filter((scenario) => scenario.opportunityId === row.id);
      return {
        ...mapOpportunity(row),
        totalBudget: budgetOf(row),
        baseScenarioLabel: own.find((scenario) => scenario.isBase)?.label ?? null,
        scenarioCount: own.length,
        documentCount:
          row.convertedBuildingId === null ? 0 : (documents.get(row.convertedBuildingId) ?? 0),
      };
    }),
    nextCursor: nextCursor(offset, limit, rows.length),
  };
}

async function readDetail(tx: Tx, id: string): Promise<OpportunityDetail> {
  const opportunity = firstOr(
    await tx
      .select()
      .from(tables.acquisitionOpportunity)
      .where(eq(tables.acquisitionOpportunity.id, id))
      .limit(1),
    "Opportunité",
  );
  const scenarios = await tx
    .select()
    .from(tables.acquisitionScenario)
    .where(eq(tables.acquisitionScenario.opportunityId, id))
    .orderBy(desc(tables.acquisitionScenario.isBase), asc(tables.acquisitionScenario.label));

  const entity =
    opportunity.legalEntityId === null
      ? []
      : await tx
          .select({ name: tables.legalEntity.name })
          .from(tables.legalEntity)
          .where(eq(tables.legalEntity.id, opportunity.legalEntityId))
          .limit(1);

  const buildingId = opportunity.convertedBuildingId;
  const [asset, loanLink, documents] = await Promise.all([
    buildingId === null
      ? []
      : tx
          .select({ id: tables.fixedAsset.id })
          .from(tables.fixedAsset)
          .where(eq(tables.fixedAsset.buildingId, buildingId))
          .limit(1),
    buildingId === null
      ? []
      : tx
          .select({ loanId: tables.loanProperty.loanId })
          .from(tables.loanProperty)
          .where(eq(tables.loanProperty.buildingId, buildingId))
          .limit(1),
    documentCounts(tx, buildingId === null ? [] : [buildingId]),
  ]);

  return {
    ...mapOpportunity(opportunity),
    totalBudget: budgetOf(opportunity),
    baseScenarioLabel: scenarios.find((scenario) => scenario.isBase)?.label ?? null,
    scenarioCount: scenarios.length,
    documentCount: buildingId === null ? 0 : (documents.get(buildingId) ?? 0),
    legalEntityName: entity[0]?.name ?? null,
    scenarios: scenarios.map((scenario) => mapScenario(scenario, opportunity)),
    conversion: {
      done: opportunity.conversionCommandId !== null,
      buildingId,
      commandId: opportunity.conversionCommandId,
      loanId: loanLink[0]?.loanId ?? null,
      fixedAssetId: asset[0]?.id ?? null,
    },
  };
}

export async function getOpportunity(tx: Tx, id: string): Promise<OpportunityDetail> {
  return readDetail(tx, id);
}

export async function createOpportunity(
  tx: Tx,
  actor: Actor,
  input: CreateAcquisitionOpportunityInput,
): Promise<OpportunityDetail> {
  const inserted = await tx
    .insert(tables.acquisitionOpportunity)
    .values({
      organizationId: actor.organizationId,
      legalEntityId: input.legalEntityId ?? null,
      label: input.label,
      addressLine1: input.addressLine1 ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      askingPrice: input.askingPrice ?? null,
      estimatedFees: input.estimatedFees ?? null,
      estimatedWorks: input.estimatedWorks ?? null,
      expectedRentYearly: input.expectedRentYearly ?? null,
      status: input.status ?? "idea",
      signedOn: input.signedOn ?? null,
    })
    .returning();
  const opportunity = firstOr(inserted, "Opportunité");
  await audit(tx, actor, {
    objectTable: "acquisition_opportunity",
    objectId: opportunity.id,
    action: "create",
    after: { label: opportunity.label, status: opportunity.status },
  });
  return readDetail(tx, opportunity.id);
}

export async function updateOpportunity(
  tx: Tx,
  actor: Actor,
  input: UpdateAcquisitionOpportunityInput,
): Promise<OpportunityDetail> {
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.legalEntityId === undefined ? {} : { legalEntityId: input.legalEntityId }),
    ...(input.addressLine1 === undefined ? {} : { addressLine1: input.addressLine1 }),
    ...(input.postalCode === undefined ? {} : { postalCode: input.postalCode }),
    ...(input.city === undefined ? {} : { city: input.city }),
    ...(input.askingPrice === undefined ? {} : { askingPrice: input.askingPrice }),
    ...(input.estimatedFees === undefined ? {} : { estimatedFees: input.estimatedFees }),
    ...(input.estimatedWorks === undefined ? {} : { estimatedWorks: input.estimatedWorks }),
    ...(input.expectedRentYearly === undefined
      ? {}
      : { expectedRentYearly: input.expectedRentYearly }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.signedOn === undefined ? {} : { signedOn: input.signedOn }),
  };
  const updated = await tx
    .update(tables.acquisitionOpportunity)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.acquisitionOpportunity.id, input.id),
        eq(tables.acquisitionOpportunity.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated[0]) versionConflict("L’opportunité");
  await audit(tx, actor, {
    objectTable: "acquisition_opportunity",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return readDetail(tx, input.id);
}

/** UX §23: archiving by status is the fourth CRUD verb; nothing is deleted. */
export async function archiveOpportunity(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number; reason: string },
): Promise<OpportunityDetail> {
  const updated = await tx
    .update(tables.acquisitionOpportunity)
    .set({
      status: "abandoned",
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tables.acquisitionOpportunity.id, input.id),
        eq(tables.acquisitionOpportunity.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated[0]) versionConflict("L’opportunité");
  await audit(tx, actor, {
    objectTable: "acquisition_opportunity",
    objectId: input.id,
    action: "archive",
    after: { status: "abandoned" },
    reason: input.reason,
  });
  return readDetail(tx, input.id);
}

function scenarioAssumptions(
  input: {
    chargesYearly?: string | undefined;
    loanRate?: string | undefined;
    loanMonths?: number | undefined;
    lender?: string | undefined;
    notes?: string | undefined;
  },
  previous: Assumptions = {},
): Assumptions {
  return {
    ...previous,
    ...(input.chargesYearly === undefined ? {} : { chargesYearly: input.chargesYearly }),
    ...(input.loanRate === undefined ? {} : { loanRate: input.loanRate }),
    ...(input.loanMonths === undefined ? {} : { loanMonths: input.loanMonths }),
    ...(input.lender === undefined ? {} : { lender: input.lender }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  };
}

/** ACQ-01: one base scenario per opportunity, so the figures shown have an owner. */
async function demoteOtherBases(tx: Tx, opportunityId: string, keepId: string): Promise<void> {
  await tx
    .update(tables.acquisitionScenario)
    .set({ isBase: false, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.acquisitionScenario.opportunityId, opportunityId),
        eq(tables.acquisitionScenario.isBase, true),
        sql`${tables.acquisitionScenario.id} <> ${keepId}::uuid`,
      ),
    );
}

export async function createScenario(
  tx: Tx,
  actor: Actor,
  input: CreateAcquisitionScenarioInput,
): Promise<OpportunityDetail> {
  const existing = await tx
    .select({ id: tables.acquisitionScenario.id })
    .from(tables.acquisitionScenario)
    .where(eq(tables.acquisitionScenario.opportunityId, input.opportunityId));
  const isBase = input.isBase ?? existing.length === 0;

  const inserted = await tx
    .insert(tables.acquisitionScenario)
    .values({
      organizationId: actor.organizationId,
      opportunityId: input.opportunityId,
      label: input.label,
      isBase,
      assumptions: scenarioAssumptions(input),
      loanAmount: input.loanAmount ?? null,
      equityAmount: input.equityAmount ?? null,
      vacancyRate: input.vacancyRate ?? null,
      unpaidRate: input.unpaidRate ?? null,
    })
    .returning();
  const scenario = firstOr(inserted, "Scénario");
  if (isBase) await demoteOtherBases(tx, input.opportunityId, scenario.id);
  await audit(tx, actor, {
    objectTable: "acquisition_scenario",
    objectId: scenario.id,
    action: "create",
    after: { label: scenario.label, isBase },
  });
  return readDetail(tx, input.opportunityId);
}

export async function updateScenario(
  tx: Tx,
  actor: Actor,
  input: UpdateAcquisitionScenarioInput,
): Promise<OpportunityDetail> {
  const current = firstOr(
    await tx
      .select()
      .from(tables.acquisitionScenario)
      .where(eq(tables.acquisitionScenario.id, input.id))
      .limit(1),
    "Scénario",
  );
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.isBase === undefined ? {} : { isBase: input.isBase }),
    ...(input.loanAmount === undefined ? {} : { loanAmount: input.loanAmount }),
    ...(input.equityAmount === undefined ? {} : { equityAmount: input.equityAmount }),
    ...(input.vacancyRate === undefined ? {} : { vacancyRate: input.vacancyRate }),
    ...(input.unpaidRate === undefined ? {} : { unpaidRate: input.unpaidRate }),
    assumptions: scenarioAssumptions(input, assumptionsOf(current)),
  };
  const updated = await tx
    .update(tables.acquisitionScenario)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.acquisitionScenario.id, input.id),
        eq(tables.acquisitionScenario.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!updated[0]) versionConflict("Le scénario");
  if (input.isBase === true) await demoteOtherBases(tx, current.opportunityId, current.id);
  await audit(tx, actor, {
    objectTable: "acquisition_scenario",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return readDetail(tx, current.opportunityId);
}

export async function removeScenario(tx: Tx, actor: Actor, id: string): Promise<OpportunityDetail> {
  const deleted = await tx
    .delete(tables.acquisitionScenario)
    .where(eq(tables.acquisitionScenario.id, id))
    .returning();
  const scenario = firstOr(deleted, "Scénario");
  await audit(tx, actor, {
    objectTable: "acquisition_scenario",
    objectId: id,
    action: "delete",
    before: { label: scenario.label },
  });
  return readDetail(tx, scenario.opportunityId);
}

/**
 * ACQ-01: the building and its links are created once, then the loan and the
 * asset are prepared as drafts and the accounting command waits for the owner's
 * validation. Called twice, the second call writes nothing.
 */
export async function convertOpportunity(
  tx: Tx,
  actor: Actor,
  input: ConvertOpportunityInput,
): Promise<ConvertOpportunityResult> {
  const opportunity = firstOr(
    await tx
      .select()
      .from(tables.acquisitionOpportunity)
      .where(eq(tables.acquisitionOpportunity.id, input.id))
      .limit(1)
      .for("update"),
    "Opportunité",
  );

  const scenarios = await tx
    .select()
    .from(tables.acquisitionScenario)
    .where(eq(tables.acquisitionScenario.opportunityId, input.id));
  const scenario =
    scenarios.find((row) => row.id === input.scenarioId) ??
    scenarios.find((row) => row.isBase) ??
    scenarios[0];

  const plan = planConversion(opportunity, scenario);
  const decisionLevel = decisionLevelByCommand.convert_acquisition;

  if (plan.kind === "already_converted") {
    const detail = await readDetail(tx, input.id);
    return {
      opportunity: detail,
      commandId: plan.commandId,
      commandStatus: "prepared",
      decisionLevel,
      alreadyConverted: true,
      buildingId: plan.buildingId,
      loanId: detail.conversion.loanId,
      fixedAssetId: detail.conversion.fixedAssetId,
    };
  }

  if (opportunity.version !== input.expectedVersion) versionConflict("L’opportunité");
  if (Number(input.landValue) > Number(input.acquisitionPrice)) {
    ruleViolation("La valeur du terrain ne peut pas dépasser le prix d’acquisition (IMM-02).");
  }

  const building = firstOr(
    await tx
      .insert(tables.building)
      .values({
        organizationId: actor.organizationId,
        legalEntityId: input.legalEntityId,
        code: input.buildingCode,
        name: input.buildingName,
        addressLine1: input.addressLine1,
        postalCode: opportunity.postalCode,
        city: opportunity.city,
        acquiredOn: input.signedOn,
        status: "active",
      })
      .returning(),
    "Immeuble",
  );

  const grossValue = sumAmounts([input.acquisitionPrice, opportunity.estimatedFees]);
  const asset = firstOr(
    await tx
      .insert(tables.fixedAsset)
      .values({
        organizationId: actor.organizationId,
        legalEntityId: input.legalEntityId,
        buildingId: building.id,
        label: input.buildingName,
        grossValue,
        landValue: input.landValue,
        commissionedOn: input.signedOn,
        method: "linear",
        status: "draft",
      })
      .returning(),
    "Immobilisation",
  );

  let loanId: string | null = null;
  if (plan.createLoan && scenario) {
    const assumptions = assumptionsOf(scenario);
    const loan = firstOr(
      await tx
        .insert(tables.loan)
        .values({
          organizationId: actor.organizationId,
          legalEntityId: input.legalEntityId,
          lenderName: assumptions.lender ?? "Prêteur à préciser",
          reference: `${input.buildingCode}-CREDIT`,
          principalAmount: amount(scenario.loanAmount),
          releasedOn: input.signedOn,
          durationMonths: assumptions.loanMonths ?? null,
          nominalRate: assumptions.loanRate ?? null,
          status: "draft",
        })
        .returning(),
      "Crédit",
    );
    loanId = loan.id;
    await tx.insert(tables.loanProperty).values({
      organizationId: actor.organizationId,
      loanId: loan.id,
      buildingId: building.id,
    });
  }

  const payload = {
    opportunityId: opportunity.id,
    legalEntityId: input.legalEntityId,
    buildingCode: input.buildingCode,
    buildingName: input.buildingName,
    signedOn: input.signedOn,
    acquisitionPrice: amount(input.acquisitionPrice),
    currency: opportunity.currency,
  };
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "building",
    id: building.id,
  });
  const command = await createCommand(tx, {
    organizationId: actor.organizationId,
    commandType: "convert_acquisition",
    operationKey: `convert_acquisition:${opportunity.id}`,
    payload,
    payloadHash: hashPayload(payload),
    targetObjectRefId: objectRefId,
    actorUserId: actor.actorUserId,
    autonomyLevel: decisionLevel,
    status: "prepared",
  });

  const updated = await tx
    .update(tables.acquisitionOpportunity)
    .set({
      status: "converted",
      signedOn: input.signedOn,
      convertedBuildingId: building.id,
      conversionCommandId: command.id,
      version: opportunity.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(tables.acquisitionOpportunity.id, input.id),
        eq(tables.acquisitionOpportunity.version, opportunity.version),
      ),
    )
    .returning();
  if (!updated[0]) versionConflict("L’opportunité");

  await recordFact(tx, actor, {
    kind: "building",
    id: building.id,
    type: "acquisition.converted",
    payload: { opportunityId: opportunity.id, commandId: command.id, loanId, assetId: asset.id },
  });
  await audit(tx, actor, {
    objectTable: "acquisition_opportunity",
    objectId: opportunity.id,
    objectRefId,
    action: "convert",
    after: { buildingId: building.id, loanId, fixedAssetId: asset.id, commandId: command.id },
  });

  return {
    opportunity: await readDetail(tx, input.id),
    commandId: command.id,
    commandStatus: command.status,
    decisionLevel,
    alreadyConverted: false,
    buildingId: building.id,
    loanId,
    fixedAssetId: asset.id,
  };
}
