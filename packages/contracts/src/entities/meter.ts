import { z } from "zod";
import {
  MeterFluid,
  MeterReadingOrigin,
  MeterReadingStatus,
  MeterScope,
  MeterStatus,
} from "../enums";
import { Audited, IsoDate, IsoDateTime, Uuid } from "../primitives";

const IndexValue = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "index décimal attendu");
const Multiplier = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "multiplicateur décimal attendu");

export const Meter = Audited.extend({
  buildingId: Uuid,
  fluid: MeterFluid,
  scope: MeterScope,
  unitOfMeasure: z.string(),
  multiplier: Multiplier,
  serialNumber: z.string().nullable(),
  prmPdl: z.string().nullable(),
  pce: z.string().nullable(),
  locationNote: z.string().nullable(),
  replacedMeterId: Uuid.nullable(),
  installedOn: IsoDate.nullable(),
  removedOn: IsoDate.nullable(),
  status: MeterStatus,
});
export type Meter = z.infer<typeof Meter>;

export const MeterReading = Audited.extend({
  meterId: Uuid,
  indexValue: IndexValue,
  readOn: IsoDate,
  origin: MeterReadingOrigin,
  inspectionId: Uuid.nullable(),
  photoDocumentId: Uuid.nullable(),
  isAfterReset: z.boolean(),
  validatedAt: IsoDateTime.nullable(),
  exceptionReason: z.string().nullable(),
  status: MeterReadingStatus,
});
export type MeterReading = z.infer<typeof MeterReading>;

export const CreateMeterReadingInput = z.strictObject({
  meterId: Uuid,
  indexValue: IndexValue,
  readOn: IsoDate,
  origin: MeterReadingOrigin,
  photoDocumentId: Uuid.optional(),
  isAfterReset: z.boolean().optional(),
  exceptionReason: z.string().optional(),
});
export type CreateMeterReadingInput = z.infer<typeof CreateMeterReadingInput>;
