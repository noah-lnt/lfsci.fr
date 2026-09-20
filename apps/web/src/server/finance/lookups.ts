import "server-only";
import { type Tx, tables } from "@lfsci/db";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { FinanceLookups } from "@/lib/contracts/finance";
import type { TravauxLookups } from "@/lib/contracts/travaux";

const PICKER_LIMIT = 200;

export async function financeLookups(tx: Tx): Promise<FinanceLookups> {
  const [legalEntities, buildings, units, persons, suppliers, accounts] = await Promise.all([
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
      .select({
        id: tables.unit.id,
        buildingId: tables.unit.buildingId,
        label: sql<string>`${tables.unit.code} || ' — ' || coalesce(${tables.unit.label}, ${tables.unit.kind})`,
      })
      .from(tables.unit)
      .orderBy(asc(tables.unit.code))
      .limit(PICKER_LIMIT),
    tx
      .select({ id: tables.person.id, label: tables.person.displayName })
      .from(tables.person)
      .orderBy(asc(tables.person.displayName))
      .limit(PICKER_LIMIT),
    tx
      .select({ id: tables.supplier.id, label: tables.supplier.name })
      .from(tables.supplier)
      .orderBy(asc(tables.supplier.name))
      .limit(PICKER_LIMIT),
    tx
      .select({
        id: tables.partnerCurrentAccount.id,
        partnerPersonId: tables.partnerCurrentAccount.partnerPersonId,
      })
      .from(tables.partnerCurrentAccount)
      .limit(PICKER_LIMIT),
  ]);

  const partnerNames =
    accounts.length === 0
      ? []
      : await tx
          .select({ id: tables.person.id, label: tables.person.displayName })
          .from(tables.person)
          .where(
            inArray(
              tables.person.id,
              accounts.map((account) => account.partnerPersonId),
            ),
          );
  const nameById = new Map(partnerNames.map((person) => [person.id, person.label]));

  return {
    legalEntities,
    buildings,
    units,
    persons,
    suppliers,
    ccaAccounts: accounts.map((account) => ({
      id: account.id,
      label: nameById.get(account.partnerPersonId) ?? "Associé",
    })),
  };
}

export async function travauxLookups(tx: Tx): Promise<TravauxLookups> {
  const [legalEntities, buildings, units, suppliers, equipment, projects] = await Promise.all([
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
      .select({
        id: tables.unit.id,
        buildingId: tables.unit.buildingId,
        label: sql<string>`${tables.unit.code} || ' — ' || coalesce(${tables.unit.label}, ${tables.unit.kind})`,
      })
      .from(tables.unit)
      .orderBy(asc(tables.unit.code))
      .limit(PICKER_LIMIT),
    tx
      .select({ id: tables.supplier.id, label: tables.supplier.name })
      .from(tables.supplier)
      .orderBy(asc(tables.supplier.name))
      .limit(PICKER_LIMIT),
    tx
      .select({ id: tables.equipment.id, label: tables.equipment.label })
      .from(tables.equipment)
      .where(eq(tables.equipment.status, "in_service"))
      .orderBy(asc(tables.equipment.label))
      .limit(PICKER_LIMIT),
    tx
      .select({ id: tables.worksProject.id, label: tables.worksProject.label })
      .from(tables.worksProject)
      .orderBy(asc(tables.worksProject.label))
      .limit(PICKER_LIMIT),
  ]);

  return { legalEntities, buildings, units, suppliers, equipment, projects };
}
