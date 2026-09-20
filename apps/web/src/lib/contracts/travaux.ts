import {
  api,
  CreateInterventionInput,
  CreateMeterReadingInput,
  Equipment,
  EquipmentStatus,
  Intervention,
  InterventionStatus,
  IsoDate,
  Meter,
  MeterFluid,
  MeterReading,
  MeterScope,
  Money,
  paginated,
  Uuid,
  Version,
  WorksProject,
  WorksProjectAccountingTreatment,
  WorksProjectNature,
  WorksProjectStatus,
} from "@lfsci/contracts";
import { oc } from "@orpc/contract";
import { z } from "zod";

export const CreateWorksProjectInput = z.strictObject({
  legalEntityId: Uuid,
  label: z.string().min(1),
  nature: WorksProjectNature.optional(),
  accountingTreatment: WorksProjectAccountingTreatment.optional(),
  budgetAmount: Money.optional(),
  buildingId: Uuid.optional(),
  unitId: Uuid.optional(),
  startsOn: IsoDate.optional(),
  endsOn: IsoDate.optional(),
});
export type CreateWorksProjectInput = z.infer<typeof CreateWorksProjectInput>;

export const UpdateWorksProjectInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  nature: WorksProjectNature.optional(),
  accountingTreatment: WorksProjectAccountingTreatment.optional(),
  budgetAmount: Money.nullable().optional(),
  status: WorksProjectStatus.optional(),
  startsOn: IsoDate.nullable().optional(),
  endsOn: IsoDate.nullable().optional(),
});
export type UpdateWorksProjectInput = z.infer<typeof UpdateWorksProjectInput>;

/** TRA-01: budget versus engaged, invoiced, paid and what is left to commit. */
export const WorksProjectBudget = z.object({
  budget: Money.nullable(),
  engaged: Money,
  invoiced: Money,
  paid: Money,
  remaining: Money.nullable(),
  expenseCount: z.number().int().min(0),
});
export type WorksProjectBudget = z.infer<typeof WorksProjectBudget>;

export const WorksProjectDetail = WorksProject.extend({
  budgetTracking: WorksProjectBudget,
  interventionCount: z.number().int().min(0),
});
export type WorksProjectDetail = z.infer<typeof WorksProjectDetail>;

export const WorksProjectRow = WorksProject.extend({ budgetTracking: WorksProjectBudget });
export type WorksProjectRow = z.infer<typeof WorksProjectRow>;

/** MAI-01: closing demands the observed result; the hours stay operational (TRA-02). */
export const TransitionInterventionInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  to: InterventionStatus,
  scheduledOn: IsoDate.optional(),
  completedOn: IsoDate.optional(),
  observedResult: z.string().min(1).optional(),
  ownerHours: z
    .string()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, "heures décimales attendues")
    .optional(),
  ownerHourlyValue: Money.optional(),
  nextCheckOn: IsoDate.optional(),
  reason: z.string().min(1).optional(),
});
export type TransitionInterventionInput = z.infer<typeof TransitionInterventionInput>;

export const InterventionDetail = Intervention.extend({
  ownerHourlyValue: Money.nullable(),
  simulatedOwnerCost: Money.nullable(),
  allowedTransitions: z.array(InterventionStatus),
  deadlineId: Uuid.nullable(),
});
export type InterventionDetail = z.infer<typeof InterventionDetail>;

export const CreateEquipmentInput = z.strictObject({
  category: z.string().min(1),
  label: z.string().min(1),
  brand: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  serialNumber: z.string().min(1).optional(),
  purchasedOn: IsoDate.optional(),
  commissionedOn: IsoDate.optional(),
  documentedCost: Money.optional(),
  warrantyUntil: IsoDate.optional(),
  supplierId: Uuid.optional(),
  status: EquipmentStatus.optional(),
});
export type CreateEquipmentInput = z.infer<typeof CreateEquipmentInput>;

export const UpdateEquipmentInput = z.strictObject({
  id: Uuid,
  expectedVersion: Version,
  label: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  warrantyUntil: IsoDate.nullable().optional(),
  status: EquipmentStatus.optional(),
});
export type UpdateEquipmentInput = z.infer<typeof UpdateEquipmentInput>;

export const CreateMeterInput = z.strictObject({
  buildingId: Uuid,
  fluid: MeterFluid,
  scope: MeterScope,
  unitOfMeasure: z.string().min(1),
  multiplier: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,6})?$/, "multiplicateur décimal attendu")
    .optional(),
  serialNumber: z.string().min(1).optional(),
  prmPdl: z.string().min(1).optional(),
  pce: z.string().min(1).optional(),
  locationNote: z.string().min(1).optional(),
  installedOn: IsoDate.optional(),
});
export type CreateMeterInput = z.infer<typeof CreateMeterInput>;

/** COM-01: an index below the previous one opens an exception, never a negative consumption. */
export const MeterReadingRow = MeterReading.extend({
  previousIndexValue: z.string().nullable(),
  consumption: z.string().nullable(),
  unitOfMeasure: z.string(),
});
export type MeterReadingRow = z.infer<typeof MeterReadingRow>;

export const MeterRow = Meter.extend({
  buildingLabel: z.string(),
  lastIndexValue: z.string().nullable(),
  lastReadOn: IsoDate.nullable(),
  openExceptions: z.number().int().min(0),
});
export type MeterRow = z.infer<typeof MeterRow>;

export const EquipmentRow = Equipment.extend({ supplierName: z.string().nullable() });
export type EquipmentRow = z.infer<typeof EquipmentRow>;

export const TravauxRef = z.object({ id: Uuid, label: z.string() });
export type TravauxRef = z.infer<typeof TravauxRef>;

/** Pickers for the travaux forms; patrimoine owns the underlying objects. */
export const TravauxLookups = z.object({
  legalEntities: z.array(TravauxRef),
  buildings: z.array(TravauxRef),
  units: z.array(TravauxRef.extend({ buildingId: Uuid })),
  suppliers: z.array(TravauxRef),
  equipment: z.array(TravauxRef),
  projects: z.array(TravauxRef),
});
export type TravauxLookups = z.infer<typeof TravauxLookups>;

export const travauxContract = {
  travaux: {
    lookups: oc
      .route({ method: "GET", path: "/travaux/lookups", summary: "Listes de sélection" })
      .input(z.strictObject({}))
      .output(TravauxLookups),
    projects: {
      list: oc
        .route({ method: "GET", path: "/travaux/projects", summary: "Projets de travaux" })
        .input(api.travaux.listWorksProjects.input)
        .output(paginated(WorksProjectRow)),
      get: oc
        .route({ method: "GET", path: "/travaux/projects/{id}", summary: "Projet de travaux" })
        .input(api.travaux.getWorksProject.input)
        .output(WorksProjectDetail),
      create: oc
        .route({ method: "POST", path: "/travaux/projects", summary: "Créer un projet" })
        .input(CreateWorksProjectInput)
        .output(WorksProject),
      update: oc
        .route({ method: "PATCH", path: "/travaux/projects/{id}", summary: "Modifier le projet" })
        .input(UpdateWorksProjectInput)
        .output(WorksProject),
    },
    interventions: {
      list: oc
        .route({ method: "GET", path: "/travaux/interventions", summary: "Interventions" })
        .input(api.travaux.listInterventions.input)
        .output(paginated(Intervention)),
      get: oc
        .route({ method: "GET", path: "/travaux/interventions/{id}", summary: "Intervention" })
        .input(api.travaux.getIntervention.input)
        .output(InterventionDetail),
      create: oc
        .route({
          method: "POST",
          path: "/travaux/interventions",
          summary: "Signaler une intervention",
        })
        .input(CreateInterventionInput)
        .output(Intervention),
      transition: oc
        .route({
          method: "POST",
          path: "/travaux/interventions/{id}/transition",
          summary: "Faire avancer l’intervention",
        })
        .input(TransitionInterventionInput)
        .output(InterventionDetail),
    },
    equipment: {
      list: oc
        .route({ method: "GET", path: "/travaux/equipment", summary: "Équipements" })
        .input(api.travaux.listEquipment.input)
        .output(paginated(EquipmentRow)),
      create: oc
        .route({ method: "POST", path: "/travaux/equipment", summary: "Créer un équipement" })
        .input(CreateEquipmentInput)
        .output(Equipment),
      update: oc
        .route({
          method: "PATCH",
          path: "/travaux/equipment/{id}",
          summary: "Modifier l’équipement",
        })
        .input(UpdateEquipmentInput)
        .output(Equipment),
    },
    meters: {
      list: oc
        .route({ method: "GET", path: "/travaux/meters", summary: "Compteurs" })
        .input(api.travaux.listMeters.input)
        .output(paginated(MeterRow)),
      create: oc
        .route({ method: "POST", path: "/travaux/meters", summary: "Créer un compteur" })
        .input(CreateMeterInput)
        .output(Meter),
      readings: {
        list: oc
          .route({
            method: "GET",
            path: "/travaux/meters/{meterId}/readings",
            summary: "Relevés du compteur",
          })
          .input(api.travaux.listMeterReadings.input)
          .output(paginated(MeterReadingRow)),
        record: oc
          .route({
            method: "POST",
            path: "/travaux/meters/{meterId}/readings",
            summary: "Enregistrer un relevé",
          })
          .input(CreateMeterReadingInput)
          .output(MeterReadingRow),
      },
    },
  },
};
