import "server-only";
import { type Tx, tables } from "@lfsci/db";
import { asc, sql } from "drizzle-orm";
import type { AssurancesLookups } from "@/lib/contracts/assurances";

const PICKER_LIMIT = 200;

const UNIT_LABEL = sql<string>`${tables.unit.code} || ' — ' || coalesce(${tables.unit.label}, ${tables.unit.kind})`;
const POLICY_LABEL = sql<string>`${tables.insurancePolicy.insurerName} || ' · ' || ${tables.insurancePolicy.policyNumber}`;
const LOAN_LABEL = sql<string>`${tables.loan.lenderName} || ' · ' || ${tables.loan.reference}`;

export async function assurancesLookups(tx: Tx): Promise<AssurancesLookups> {
  const [legalEntities, buildings, units, persons, leases, loans, equipment, policies, works] =
    await Promise.all([
      tx
        .select({ id: tables.legalEntity.id, label: tables.legalEntity.name })
        .from(tables.legalEntity)
        .orderBy(asc(tables.legalEntity.name))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.building.id, label: tables.building.name })
        .from(tables.building)
        .orderBy(asc(tables.building.name))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.unit.id, buildingId: tables.unit.buildingId, label: UNIT_LABEL })
        .from(tables.unit)
        .orderBy(asc(tables.unit.code))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.person.id, label: tables.person.displayName })
        .from(tables.person)
        .orderBy(asc(tables.person.displayName))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.lease.id, label: tables.lease.reference })
        .from(tables.lease)
        .orderBy(asc(tables.lease.reference))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.loan.id, label: LOAN_LABEL })
        .from(tables.loan)
        .orderBy(asc(tables.loan.reference))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.equipment.id, label: tables.equipment.label })
        .from(tables.equipment)
        .orderBy(asc(tables.equipment.label))
        .limit(PICKER_LIMIT),
      tx
        .select({ id: tables.insurancePolicy.id, label: POLICY_LABEL })
        .from(tables.insurancePolicy)
        .orderBy(asc(tables.insurancePolicy.insurerName))
        .limit(PICKER_LIMIT),
      tx
        .select({
          id: tables.intervention.id,
          label: tables.intervention.title,
          claimId: tables.intervention.claimId,
          version: tables.intervention.version,
        })
        .from(tables.intervention)
        .orderBy(asc(tables.intervention.title))
        .limit(PICKER_LIMIT),
    ]);

  return {
    legalEntities,
    buildings,
    units,
    persons,
    leases,
    loans,
    equipment,
    policies,
    interventions: works,
  };
}
