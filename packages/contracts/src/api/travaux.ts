import { z } from "zod";
import {
  byId,
  CreateInterventionInput,
  CreateMeterReadingInput,
  Equipment,
  Intervention,
  listInput,
  Meter,
  MeterReading,
  paginated,
  UpdateInterventionInput,
  WorksProject,
} from "../entities";
import {
  EquipmentStatus,
  InterventionStatus,
  InterventionUrgency,
  WorksProjectStatus,
} from "../enums";
import { IsoDate, Uuid } from "../primitives";

export const listWorksProjects = {
  input: listInput({
    legalEntityId: Uuid.optional(),
    buildingId: Uuid.optional(),
    status: WorksProjectStatus.optional(),
  }),
  output: paginated(WorksProject),
};
export const getWorksProject = { input: byId, output: WorksProject };

export const listInterventions = {
  input: listInput({
    worksProjectId: Uuid.optional(),
    buildingId: Uuid.optional(),
    unitId: Uuid.optional(),
    status: InterventionStatus.optional(),
    urgency: InterventionUrgency.optional(),
    openOnly: z.boolean().optional(),
  }),
  output: paginated(Intervention),
};
export const getIntervention = { input: byId, output: Intervention };
export const createIntervention = { input: CreateInterventionInput, output: Intervention };
export const updateIntervention = { input: UpdateInterventionInput, output: Intervention };

export const listEquipment = {
  input: listInput({
    buildingId: Uuid.optional(),
    unitId: Uuid.optional(),
    status: EquipmentStatus.optional(),
  }),
  output: paginated(Equipment),
};

export const listMeters = {
  input: listInput({ buildingId: Uuid.optional(), unitId: Uuid.optional() }),
  output: paginated(Meter),
};
export const listMeterReadings = {
  input: listInput({ meterId: Uuid, from: IsoDate.optional(), to: IsoDate.optional() }),
  output: paginated(MeterReading),
};
export const createMeterReading = { input: CreateMeterReadingInput, output: MeterReading };
