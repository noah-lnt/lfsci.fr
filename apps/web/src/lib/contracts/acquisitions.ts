import {
  AcquisitionOpportunity,
  AcquisitionOpportunityStatus,
  AcquisitionScenario,
  CreateAcquisitionOpportunityInput,
  CreateAcquisitionScenarioInput,
  DecisionLevel,
  IsoDate,
  listInput,
  Money,
  paginated,
  UpdateAcquisitionOpportunityInput,
  UpdateAcquisitionScenarioInput,
  Uuid,
  Version,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** ACQ-01: the scenario's figures, computed by the domain, never in the screen. */
export const ScenarioOutcome = z.object({
  totalBudget: Money,
  financed: Money,
  financingGap: Money,
  effectiveRentYearly: Money,
  netOperatingIncomeYearly: Money,
  monthlyInstallment: Money,
  monthlyCashflow: Money,
  yearlyCashflow: Money,
  grossYield: Money,
  netYield: Money,
});
export type ScenarioOutcome = z.infer<typeof ScenarioOutcome>;

export const ScenarioWithOutcome = AcquisitionScenario.extend({
  outcome: ScenarioOutcome,
  chargesYearly: Money,
  loanRate: z.string(),
  loanMonths: z.number().int().nonnegative(),
  notes: z.string().nullable(),
});
export type ScenarioWithOutcome = z.infer<typeof ScenarioWithOutcome>;

export const OpportunityRow = AcquisitionOpportunity.extend({
  totalBudget: Money,
  baseScenarioLabel: z.string().nullable(),
  scenarioCount: z.number().int().nonnegative(),
  documentCount: z.number().int().nonnegative(),
});
export type OpportunityRow = z.infer<typeof OpportunityRow>;

export const OpportunityDetail = OpportunityRow.extend({
  legalEntityName: z.string().nullable(),
  scenarios: z.array(ScenarioWithOutcome),
  conversion: z.object({
    done: z.boolean(),
    buildingId: Uuid.nullable(),
    commandId: Uuid.nullable(),
    loanId: Uuid.nullable(),
    fixedAssetId: Uuid.nullable(),
  }),
});
export type OpportunityDetail = z.infer<typeof OpportunityDetail>;

/**
 * ACQ-01: the conversion creates the building and its links once, then prepares
 * the loan and the asset; a second call returns the first one's result.
 */
export const ConvertOpportunityInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  legalEntityId: Uuid,
  buildingCode: z.string().min(1),
  buildingName: z.string().min(1),
  addressLine1: z.string().min(1),
  signedOn: IsoDate,
  acquisitionPrice: Money,
  landValue: Money,
  scenarioId: Uuid.optional(),
});
export type ConvertOpportunityInput = z.infer<typeof ConvertOpportunityInput>;

export const ConvertOpportunityResult = z.object({
  opportunity: OpportunityDetail,
  commandId: Uuid,
  commandStatus: z.string(),
  decisionLevel: DecisionLevel,
  alreadyConverted: z.boolean(),
  buildingId: Uuid,
  loanId: Uuid.nullable(),
  fixedAssetId: Uuid.nullable(),
});
export type ConvertOpportunityResult = z.infer<typeof ConvertOpportunityResult>;

export const acquisitionsContract = {
  acquisitions: {
    list: oc
      .route({ method: "GET", path: "/acquisitions", summary: "Opportunités d’acquisition" })
      .input(listInput({ status: AcquisitionOpportunityStatus.optional() }))
      .output(paginated(OpportunityRow)),
    get: oc
      .route({ method: "GET", path: "/acquisitions/{id}", summary: "Opportunité" })
      .input(z.strictObject({ id: Uuid }))
      .output(OpportunityDetail),
    create: oc
      .route({ method: "POST", path: "/acquisitions", summary: "Créer une opportunité" })
      .input(CreateAcquisitionOpportunityInput)
      .output(OpportunityDetail),
    update: oc
      .route({ method: "PATCH", path: "/acquisitions/{id}", summary: "Modifier l’opportunité" })
      .input(UpdateAcquisitionOpportunityInput)
      .output(OpportunityDetail),
    archive: oc
      .route({
        method: "POST",
        path: "/acquisitions/{id}/archive",
        summary: "Abandonner l’opportunité",
      })
      .input(z.strictObject({ id: Uuid, expectedVersion: Version, reason: z.string().min(1) }))
      .output(OpportunityDetail),
    scenarios: {
      create: oc
        .route({
          method: "POST",
          path: "/acquisitions/{opportunityId}/scenarios",
          summary: "Ajouter un scénario",
        })
        .input(CreateAcquisitionScenarioInput)
        .output(OpportunityDetail),
      update: oc
        .route({
          method: "PATCH",
          path: "/acquisitions/scenarios/{id}",
          summary: "Modifier le scénario",
        })
        .input(UpdateAcquisitionScenarioInput)
        .output(OpportunityDetail),
      remove: oc
        .route({
          method: "DELETE",
          path: "/acquisitions/scenarios/{id}",
          summary: "Supprimer le scénario",
        })
        .input(z.strictObject({ id: Uuid }))
        .output(OpportunityDetail),
    },
    convert: oc
      .route({
        method: "POST",
        path: "/acquisitions/{id}/convert",
        summary: "Convertir l’opportunité",
      })
      .input(ConvertOpportunityInput)
      .output(ConvertOpportunityResult),
  },
};
