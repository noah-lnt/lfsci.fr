import "server-only";
import type {
  CreateAssetComponentInput,
  CreateFixedAssetInput,
  UpdateAssetComponentInput,
  UpdateFixedAssetInput,
} from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import {
  annualDepreciation,
  assetRegister,
  type ComponentKind,
  type RegisterComponent,
} from "@lfsci/domain";
import { and, asc, eq } from "drizzle-orm";
import type {
  AssetComponentPosition,
  DisposeAssetInput,
  FixedAssetDetail,
} from "@/lib/contracts/finance";
import { type Actor, audit, recordFact } from "./facts";
import { mapAssetComponent, mapFixedAssetPosition } from "./mappers";
import { firstOr, ruleViolation, today, versionConflict } from "./shared";

type AssetRow = typeof tables.fixedAsset.$inferSelect;
type ComponentRow = typeof tables.assetComponent.$inferSelect;

/**
 * IMM-02: a row that is not depreciable is land, whatever it is called. The
 * asset's own `land_value` is one such component so the register never has to
 * infer a land share.
 */
const LAND_COMPONENT = "land";

function kindOf(row: ComponentRow): ComponentKind {
  return row.isDepreciable ? "building" : "land";
}

function registerInput(asset: AssetRow, components: readonly ComponentRow[]): RegisterComponent[] {
  const declared = components.map<RegisterComponent>((row) => ({
    id: row.id,
    label: row.label,
    kind: kindOf(row),
    gross: row.grossValue,
    startDate: row.commissionedOn ?? asset.commissionedOn,
    durationYears: row.durationYears ?? asset.durationYears,
  }));
  if (declared.length > 0) return declared;

  // No component captured yet: the asset itself is read as land plus structure.
  const structure = Number(asset.grossValue) - Number(asset.landValue);
  return [
    {
      id: `${asset.id}:${LAND_COMPONENT}`,
      label: "Terrain",
      kind: "land",
      gross: asset.landValue,
      startDate: asset.commissionedOn,
      durationYears: null,
    },
    {
      id: `${asset.id}:structure`,
      label: asset.label,
      kind: "building",
      gross: structure.toFixed(2),
      startDate: asset.commissionedOn,
      durationYears: asset.durationYears,
    },
  ];
}

async function readDetail(tx: Tx, id: string): Promise<FixedAssetDetail> {
  const asset = firstOr(
    await tx.select().from(tables.fixedAsset).where(eq(tables.fixedAsset.id, id)).limit(1),
    "Immobilisation",
  );
  const components = await tx
    .select()
    .from(tables.assetComponent)
    .where(eq(tables.assetComponent.fixedAssetId, id))
    .orderBy(asc(tables.assetComponent.label));

  const on = today();
  const input = registerInput(asset, components);
  const register = assetRegister({ asOf: on, components: input });
  const lineById = new Map(register.lines.map((line) => [line.id, line]));

  const positions = components.map<AssetComponentPosition>((row) => {
    const line = lineById.get(row.id);
    return {
      ...mapAssetComponent(row),
      accumulated: line?.accumulated ?? "0.00",
      netBookValue: line?.netBookValue ?? row.grossValue,
      durationSource: line?.durationSource ?? "none",
      durationMonths: line?.durationMonths ?? 0,
      computable: line?.computable ?? false,
    };
  });

  const [building, unit] = await Promise.all([
    asset.buildingId === null
      ? []
      : tx
          .select({ label: tables.building.name })
          .from(tables.building)
          .where(eq(tables.building.id, asset.buildingId))
          .limit(1),
    asset.unitId === null
      ? []
      : tx
          .select({ label: tables.unit.label })
          .from(tables.unit)
          .where(eq(tables.unit.id, asset.unitId))
          .limit(1),
  ]);

  return {
    ...mapFixedAssetPosition(asset, on, components.length),
    buildingLabel: building[0]?.label ?? null,
    unitLabel: unit[0]?.label ?? null,
    components: positions,
    register: {
      asOf: register.asOf,
      gross: register.gross,
      land: register.land,
      depreciableGross: register.depreciableGross,
      accumulated: register.accumulated,
      netBookValue: register.netBookValue,
      usesDefaultDuration: register.usesDefaultDuration,
    },
    years: annualDepreciation(input),
  };
}

export async function getAssetDetail(tx: Tx, id: string): Promise<FixedAssetDetail> {
  return readDetail(tx, id);
}

export async function createAsset(
  tx: Tx,
  actor: Actor,
  input: CreateFixedAssetInput,
): Promise<FixedAssetDetail> {
  if (Number(input.landValue) > Number(input.grossValue)) {
    ruleViolation("La valeur du terrain ne peut pas dépasser la valeur brute (IMM-02).");
  }
  const asset = firstOr(
    await tx
      .insert(tables.fixedAsset)
      .values({
        organizationId: actor.organizationId,
        legalEntityId: input.legalEntityId,
        buildingId: input.buildingId ?? null,
        unitId: input.unitId ?? null,
        label: input.label,
        grossValue: input.grossValue,
        landValue: input.landValue,
        commissionedOn: input.commissionedOn ?? null,
        durationYears: input.durationYears ?? null,
        method: input.method ?? "linear",
        status: input.commissionedOn === undefined ? "draft" : "running",
      })
      .returning(),
    "Immobilisation",
  );

  await recordFact(tx, actor, {
    kind: "fixed_asset",
    id: asset.id,
    type: "fixed_asset.created",
    payload: { grossValue: asset.grossValue, landValue: asset.landValue },
  });
  await audit(tx, actor, {
    objectTable: "fixed_asset",
    objectId: asset.id,
    action: "create",
    after: { label: asset.label, grossValue: asset.grossValue },
  });
  return readDetail(tx, asset.id);
}

export async function updateAsset(
  tx: Tx,
  actor: Actor,
  input: UpdateFixedAssetInput,
): Promise<FixedAssetDetail> {
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.grossValue === undefined ? {} : { grossValue: input.grossValue }),
    ...(input.landValue === undefined ? {} : { landValue: input.landValue }),
    ...(input.commissionedOn === undefined ? {} : { commissionedOn: input.commissionedOn }),
    ...(input.durationYears === undefined ? {} : { durationYears: input.durationYears }),
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(input.status === undefined ? {} : { status: input.status }),
  };
  const updated = await tx
    .update(tables.fixedAsset)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(eq(tables.fixedAsset.id, input.id), eq(tables.fixedAsset.version, input.expectedVersion)),
    )
    .returning();
  if (!updated[0]) versionConflict("L’immobilisation");
  await audit(tx, actor, {
    objectTable: "fixed_asset",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return readDetail(tx, input.id);
}

/** IMM-01: a disposal is a status and a date, never a deletion. */
export async function disposeAsset(
  tx: Tx,
  actor: Actor,
  input: DisposeAssetInput,
): Promise<FixedAssetDetail> {
  const updated = await tx
    .update(tables.fixedAsset)
    .set({
      status: "disposed",
      disposedOn: input.disposedOn,
      version: input.expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(eq(tables.fixedAsset.id, input.id), eq(tables.fixedAsset.version, input.expectedVersion)),
    )
    .returning();
  if (!updated[0]) versionConflict("L’immobilisation");
  await recordFact(tx, actor, {
    kind: "fixed_asset",
    id: input.id,
    type: "fixed_asset.disposed",
    payload: { disposedOn: input.disposedOn, reason: input.reason },
  });
  await audit(tx, actor, {
    objectTable: "fixed_asset",
    objectId: input.id,
    action: "dispose",
    after: { disposedOn: input.disposedOn },
    reason: input.reason,
  });
  return readDetail(tx, input.id);
}

export async function addComponent(
  tx: Tx,
  actor: Actor,
  input: CreateAssetComponentInput,
): Promise<FixedAssetDetail> {
  const inserted = await tx
    .insert(tables.assetComponent)
    .values({
      organizationId: actor.organizationId,
      fixedAssetId: input.fixedAssetId,
      label: input.label,
      grossValue: input.grossValue,
      durationYears: input.durationYears ?? null,
      commissionedOn: input.commissionedOn ?? null,
      isDepreciable: input.isDepreciable ?? true,
      equipmentId: input.equipmentId ?? null,
      replacedComponentId: input.replacedComponentId ?? null,
    })
    .returning();
  const component = firstOr(inserted, "Composant");
  await audit(tx, actor, {
    objectTable: "asset_component",
    objectId: component.id,
    action: "create",
    after: { label: component.label, grossValue: component.grossValue },
  });
  return readDetail(tx, input.fixedAssetId);
}

export async function updateComponent(
  tx: Tx,
  actor: Actor,
  input: UpdateAssetComponentInput,
): Promise<FixedAssetDetail> {
  const patch = {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.grossValue === undefined ? {} : { grossValue: input.grossValue }),
    ...(input.durationYears === undefined ? {} : { durationYears: input.durationYears }),
    ...(input.commissionedOn === undefined ? {} : { commissionedOn: input.commissionedOn }),
    ...(input.isDepreciable === undefined ? {} : { isDepreciable: input.isDepreciable }),
  };
  const updated = await tx
    .update(tables.assetComponent)
    .set({ ...patch, version: input.expectedVersion + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(tables.assetComponent.id, input.id),
        eq(tables.assetComponent.version, input.expectedVersion),
      ),
    )
    .returning();
  const component = updated[0];
  if (!component) versionConflict("Le composant");
  await audit(tx, actor, {
    objectTable: "asset_component",
    objectId: input.id,
    action: "update",
    after: patch,
  });
  return readDetail(tx, component.fixedAssetId);
}

export async function removeComponent(tx: Tx, actor: Actor, id: string): Promise<FixedAssetDetail> {
  const deleted = await tx
    .delete(tables.assetComponent)
    .where(eq(tables.assetComponent.id, id))
    .returning();
  const component = firstOr(deleted, "Composant");
  await audit(tx, actor, {
    objectTable: "asset_component",
    objectId: id,
    action: "delete",
    before: { label: component.label, grossValue: component.grossValue },
  });
  return readDetail(tx, component.fixedAssetId);
}
