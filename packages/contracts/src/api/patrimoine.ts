import { z } from "zod";
import {
  Building,
  byId,
  CreateBuildingInput,
  CreateLegalEntityInput,
  CreateUnitInput,
  LegalEntity,
  listInput,
  ObjectRef,
  paginated,
  TimelineItem,
  Unit,
  UnitUsagePeriod,
  UpdateBuildingInput,
  UpdateLegalEntityInput,
  UpdateUnitInput,
} from "../entities";
import { BuildingStatus, LegalEntityStatus, UnitKind, UnitStatus } from "../enums";
import { IsoDate, Uuid } from "../primitives";

export const listLegalEntities = {
  input: listInput({ status: LegalEntityStatus.optional(), search: z.string().optional() }),
  output: paginated(LegalEntity),
};
export const getLegalEntity = { input: byId, output: LegalEntity };
export const createLegalEntity = { input: CreateLegalEntityInput, output: LegalEntity };
export const updateLegalEntity = { input: UpdateLegalEntityInput, output: LegalEntity };

export const listBuildings = {
  input: listInput({
    legalEntityId: Uuid.optional(),
    status: BuildingStatus.optional(),
    search: z.string().optional(),
  }),
  output: paginated(Building),
};
export const getBuilding = { input: byId, output: Building };
export const createBuilding = { input: CreateBuildingInput, output: Building };
export const updateBuilding = { input: UpdateBuildingInput, output: Building };

export const listUnits = {
  input: listInput({
    buildingId: Uuid.optional(),
    legalEntityId: Uuid.optional(),
    kind: UnitKind.optional(),
    status: UnitStatus.optional(),
  }),
  output: paginated(Unit),
};
export const getUnit = {
  input: byId,
  output: Unit.extend({ usagePeriods: z.array(UnitUsagePeriod) }),
};
export const createUnit = { input: CreateUnitInput, output: Unit };
export const updateUnit = { input: UpdateUnitInput, output: Unit };

/** Spec §16.1 GET /v1/timeline: one object's activities, events and deadlines. */
export const getTimeline = {
  input: listInput({
    object: ObjectRef,
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    kinds: z.array(z.enum(["activity", "event", "deadline"])).optional(),
  }),
  output: paginated(TimelineItem),
};
