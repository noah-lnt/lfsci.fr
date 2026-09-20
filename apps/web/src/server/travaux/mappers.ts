import "server-only";
import type { Equipment, Intervention, Meter, MeterReading, WorksProject } from "@lfsci/contracts";
import type { tables } from "@lfsci/db";
import { decimal, toMoney } from "@lfsci/domain";
import type { InterventionDetail, MeterReadingRow } from "@/lib/contracts/travaux";
import { amount, amountOrNull, instant, instantOrNow } from "../finance/shared";

type WorksProjectRowIn = typeof tables.worksProject.$inferSelect;
type InterventionRowIn = typeof tables.intervention.$inferSelect;
type EquipmentRowIn = typeof tables.equipment.$inferSelect;
type MeterRowIn = typeof tables.meter.$inferSelect;
type MeterReadingRowIn = typeof tables.meterReading.$inferSelect;

function audited(row: { createdAt: string; updatedAt: string | null; version: number }) {
  return {
    createdAt: instantOrNow(row.createdAt),
    updatedAt: instant(row.updatedAt),
    version: row.version,
  };
}

export function mapWorksProject(row: WorksProjectRowIn): WorksProject {
  return {
    id: row.id,
    ...audited(row),
    legalEntityId: row.legalEntityId,
    buildingId: row.buildingId,
    unitId: row.unitId,
    label: row.label,
    nature: row.nature as WorksProject["nature"],
    accountingTreatment: row.accountingTreatment as WorksProject["accountingTreatment"],
    budgetAmount: amountOrNull(row.budgetAmount),
    currency: row.currency,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    status: row.status as WorksProject["status"],
  };
}

export function mapIntervention(row: InterventionRowIn): Intervention {
  return {
    id: row.id,
    ...audited(row),
    worksProjectId: row.worksProjectId,
    buildingId: row.buildingId,
    unitId: row.unitId,
    equipmentId: row.equipmentId,
    leaseId: row.leaseId,
    claimId: row.claimId,
    title: row.title,
    description: row.description,
    urgency: row.urgency as Intervention["urgency"],
    status: row.status as Intervention["status"],
    performedBy: row.performedBy as Intervention["performedBy"],
    supplierId: row.supplierId,
    reportedOn: row.reportedOn,
    scheduledOn: row.scheduledOn,
    completedOn: row.completedOn,
    ownerHours: row.ownerHours,
    observedResult: row.observedResult,
    nextCheckOn: row.nextCheckOn,
  };
}

/** TRA-02: the valued hours stay a simulated economic cost, never an expense. */
export function mapInterventionDetail(
  row: InterventionRowIn,
  allowedTransitions: readonly Intervention["status"][],
  deadlineId: string | null,
): InterventionDetail {
  const hourlyValue = amountOrNull(row.ownerHourlyValue);
  return {
    ...mapIntervention(row),
    ownerHourlyValue: hourlyValue,
    simulatedOwnerCost:
      row.ownerHours === null || hourlyValue === null
        ? null
        : toMoney(decimal(row.ownerHours).times(decimal(hourlyValue))),
    allowedTransitions: [...allowedTransitions],
    deadlineId,
  };
}

export function mapEquipment(row: EquipmentRowIn): Equipment {
  return {
    id: row.id,
    ...audited(row),
    category: row.category,
    label: row.label,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    qrCode: row.qrCode,
    purchasedOn: row.purchasedOn,
    commissionedOn: row.commissionedOn,
    documentedCost: amountOrNull(row.documentedCost),
    currency: row.currency,
    warrantyUntil: row.warrantyUntil,
    supplierId: row.supplierId,
    fixedAssetId: row.fixedAssetId,
    status: row.status as Equipment["status"],
  };
}

export function mapMeter(row: MeterRowIn): Meter {
  return {
    id: row.id,
    ...audited(row),
    buildingId: row.buildingId,
    fluid: row.fluid as Meter["fluid"],
    scope: row.scope as Meter["scope"],
    unitOfMeasure: row.unitOfMeasure,
    multiplier: row.multiplier,
    serialNumber: row.serialNumber,
    prmPdl: row.prmPdl,
    pce: row.pce,
    locationNote: row.locationNote,
    replacedMeterId: row.replacedMeterId,
    installedOn: row.installedOn,
    removedOn: row.removedOn,
    status: row.status as Meter["status"],
  };
}

export function mapMeterReading(row: MeterReadingRowIn): MeterReading {
  return {
    id: row.id,
    ...audited(row),
    meterId: row.meterId,
    indexValue: row.indexValue,
    readOn: row.readOn,
    origin: row.origin as MeterReading["origin"],
    inspectionId: row.inspectionId,
    photoDocumentId: row.photoDocumentId,
    isAfterReset: row.isAfterReset,
    validatedAt: instant(row.validatedAt),
    exceptionReason: row.exceptionReason,
    status: row.status as MeterReading["status"],
  };
}

/**
 * COM-01: consumption is the index difference times the multiplier, and it
 * exists only when the previous index is lower — otherwise the row is an
 * exception and consumption stays absent rather than negative.
 */
export function mapMeterReadingRow(
  row: MeterReadingRowIn,
  previousIndexValue: string | null,
  meter: { multiplier: string; unitOfMeasure: string },
): MeterReadingRow {
  const consumable =
    previousIndexValue !== null &&
    row.status !== "exception" &&
    decimal(row.indexValue).greaterThanOrEqualTo(decimal(previousIndexValue));
  return {
    ...mapMeterReading(row),
    previousIndexValue,
    consumption: consumable
      ? decimal(row.indexValue)
          .minus(decimal(previousIndexValue ?? "0"))
          .times(decimal(meter.multiplier))
          .toFixed(4)
      : null,
    unitOfMeasure: meter.unitOfMeasure,
  };
}

export { amount };
