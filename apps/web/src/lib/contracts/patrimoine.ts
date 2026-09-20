import { api, IsoDate, Unit, UnitUsagePeriod, UnitUsagePeriodUsage, Uuid } from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

/** PAT-01: a usage change opens a dated period, it never rewrites the previous one. */
export const SetUnitUsageInput = z.strictObject({
  unitId: Uuid,
  usage: UnitUsagePeriodUsage,
  startsOn: IsoDate,
  endsOn: IsoDate.optional(),
  note: z.string().max(500).optional(),
});
export type SetUnitUsageInput = z.infer<typeof SetUnitUsageInput>;

export const SetUnitUsageOutput = z.object({
  unit: Unit,
  usagePeriods: z.array(UnitUsagePeriod),
});
export type SetUnitUsageOutput = z.infer<typeof SetUnitUsageOutput>;

export const patrimoineContract = {
  patrimoine: {
    legalEntities: {
      list: oc
        .route({ method: "GET", path: "/patrimoine/sci", summary: "Liste des SCI" })
        .input(api.patrimoine.listLegalEntities.input)
        .output(api.patrimoine.listLegalEntities.output),
      get: oc
        .route({ method: "GET", path: "/patrimoine/sci/{id}", summary: "Une SCI" })
        .input(api.patrimoine.getLegalEntity.input)
        .output(api.patrimoine.getLegalEntity.output),
      create: oc
        .route({ method: "POST", path: "/patrimoine/sci", summary: "Créer une SCI" })
        .input(api.patrimoine.createLegalEntity.input)
        .output(api.patrimoine.createLegalEntity.output),
      update: oc
        .route({ method: "PATCH", path: "/patrimoine/sci", summary: "Modifier une SCI" })
        .input(api.patrimoine.updateLegalEntity.input)
        .output(api.patrimoine.updateLegalEntity.output),
    },
    buildings: {
      list: oc
        .route({ method: "GET", path: "/patrimoine/immeubles", summary: "Liste des immeubles" })
        .input(api.patrimoine.listBuildings.input)
        .output(api.patrimoine.listBuildings.output),
      get: oc
        .route({ method: "GET", path: "/patrimoine/immeubles/{id}", summary: "Un immeuble" })
        .input(api.patrimoine.getBuilding.input)
        .output(api.patrimoine.getBuilding.output),
      create: oc
        .route({ method: "POST", path: "/patrimoine/immeubles", summary: "Créer un immeuble" })
        .input(api.patrimoine.createBuilding.input)
        .output(api.patrimoine.createBuilding.output),
      update: oc
        .route({ method: "PATCH", path: "/patrimoine/immeubles", summary: "Modifier un immeuble" })
        .input(api.patrimoine.updateBuilding.input)
        .output(api.patrimoine.updateBuilding.output),
    },
    units: {
      list: oc
        .route({ method: "GET", path: "/patrimoine/lots", summary: "Liste des lots" })
        .input(api.patrimoine.listUnits.input)
        .output(api.patrimoine.listUnits.output),
      get: oc
        .route({ method: "GET", path: "/patrimoine/lots/{id}", summary: "Un lot" })
        .input(api.patrimoine.getUnit.input)
        .output(api.patrimoine.getUnit.output),
      create: oc
        .route({ method: "POST", path: "/patrimoine/lots", summary: "Créer un lot" })
        .input(api.patrimoine.createUnit.input)
        .output(api.patrimoine.createUnit.output),
      update: oc
        .route({ method: "PATCH", path: "/patrimoine/lots", summary: "Modifier un lot" })
        .input(api.patrimoine.updateUnit.input)
        .output(api.patrimoine.updateUnit.output),
      setUsage: oc
        .route({
          method: "POST",
          path: "/patrimoine/lots/usage",
          summary: "Ouvrir une période d’usage",
        })
        .input(SetUnitUsageInput)
        .output(SetUnitUsageOutput),
    },
    timeline: oc
      .route({ method: "GET", path: "/patrimoine/timeline", summary: "Chronologie d’un objet" })
      .input(api.patrimoine.getTimeline.input)
      .output(api.patrimoine.getTimeline.output),
  },
};
