import "server-only";
import { decisionLevelByCommand } from "@lfsci/contracts";
import { createCommand, ensureObjectRef, hashPayload, type Tx, tables } from "@lfsci/db";
import {
  type AllocationKey,
  allocationKeyTotal,
  type ChargePosting,
  daysBetween,
  money,
  type RegularisationOccupancy,
  regulariseProvisions,
  spreadRecoverableCharges,
  toMoney,
} from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import {
  type ActivateKeyVersionInput,
  type AddKeyVersionInput,
  AllocationKeyRead,
  CloseRunResult,
  type CreateAllocationKeyInput,
  type CreateRunInput,
  RegularizationRunRead,
  type RunExclusionRead,
  type RunLineRead,
  type RunPostingRead,
  type RunSummaryRead,
  type SpreadLotRead,
  StatementResult,
  type UpdateKeyVersionInput,
} from "@/lib/contracts/charges";
import { tenant } from "../../data";
import { audit, recordFact } from "../../finance/facts";
import {
  addDays,
  amount,
  firstOr,
  instant,
  notFound,
  ruleViolation,
  sumAmounts,
  today,
  versionConflict,
} from "../../finance/shared";
import { enqueueJob } from "../../queue";
import { validated, withOrganization } from "../base";
import type { RpcContext } from "../context";

/** Fixed namespace: a command's operation key is derived from its object, never random. */
const OPERATION_NAMESPACE = "8d41f0a6-0b2e-4a51-9d4d-3a61f6b8c7d2";
const FROZEN_EVENT = "regularization.frozen";
const STATEMENT_DUE_DAYS = 30;

type Scoped = RpcContext & { organizationId: string };

function actorOf(context: Scoped) {
  return { organizationId: context.organizationId, actorUserId: context.session?.user.id ?? null };
}

function scope(context: Scoped) {
  return {
    requestId: context.requestId,
    session: context.session,
    organizationId: context.organizationId,
  };
}

function operationKey(command: string, objectId: string): string {
  return uuidv5(`${command}:${objectId}`, OPERATION_NAMESPACE);
}

type KeyVersionRow = typeof tables.chargeAllocationKeyVersion.$inferSelect;
type ShareRow = typeof tables.chargeAllocationShare.$inferSelect;

async function unitLabels(tx: Tx, unitIds: string[]): Promise<Map<string, string>> {
  if (unitIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: tables.unit.id, code: tables.unit.code, label: tables.unit.label })
    .from(tables.unit)
    .where(inArray(tables.unit.id, unitIds));
  return new Map(rows.map((row) => [row.id, `${row.code} — ${row.label}`]));
}

/** WF-07: a version a frozen run used is history; the screen must never offer it for edit. */
async function runsUsingKeyVersions(tx: Tx): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({ payload: tables.event.payload })
    .from(tables.event)
    .where(eq(tables.event.type, FROZEN_EVENT));
  const used = new Map<string, string[]>();
  for (const row of rows) {
    const payload = row.payload as { runId?: string; keyVersionIds?: string[] } | null;
    if (!payload?.runId) continue;
    for (const keyVersionId of payload.keyVersionIds ?? []) {
      used.set(keyVersionId, [...(used.get(keyVersionId) ?? []), payload.runId]);
    }
  }
  return used;
}

async function readKey(tx: Tx, keyId: string): Promise<AllocationKeyRead> {
  const key = firstOr(
    await tx
      .select()
      .from(tables.chargeAllocationKey)
      .where(eq(tables.chargeAllocationKey.id, keyId))
      .limit(1),
    "Clé de répartition",
  );
  const versions = await tx
    .select()
    .from(tables.chargeAllocationKeyVersion)
    .where(eq(tables.chargeAllocationKeyVersion.allocationKeyId, keyId))
    .orderBy(asc(tables.chargeAllocationKeyVersion.sequence));
  const shares =
    versions.length === 0
      ? []
      : await tx
          .select()
          .from(tables.chargeAllocationShare)
          .where(
            inArray(
              tables.chargeAllocationShare.keyVersionId,
              versions.map((version) => version.id),
            ),
          );

  const labels = await unitLabels(
    tx,
    shares.map((share) => share.unitId).filter((id): id is string => id !== null),
  );
  const buildings = await tx
    .select({ id: tables.building.id, name: tables.building.name })
    .from(tables.building);
  const buildingName = new Map(buildings.map((row) => [row.id, row.name]));
  const entities = await tx
    .select({ id: tables.legalEntity.id, name: tables.legalEntity.name })
    .from(tables.legalEntity);
  const entityName = new Map(entities.map((row) => [row.id, row.name]));
  const used = await runsUsingKeyVersions(tx);

  return AllocationKeyRead.parse({
    id: key.id,
    code: key.code,
    label: key.label,
    basis: key.basis,
    status: key.status,
    buildingId: key.buildingId,
    buildingName: key.buildingId ? (buildingName.get(key.buildingId) ?? null) : null,
    legalEntityId: key.legalEntityId,
    legalEntityName: key.legalEntityId ? (entityName.get(key.legalEntityId) ?? null) : null,
    version: key.version,
    versions: versions.map((version) => {
      const own = shares.filter((share) => share.keyVersionId === version.id);
      const total = allocationKeyTotal(own.map((share) => ({ share: share.share })));
      const usedBy = used.get(version.id) ?? [];
      return {
        id: version.id,
        sequence: version.sequence,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        roundingRule: version.roundingRule,
        justification: version.justification,
        status: version.status,
        sharesTotal: total.total,
        sharesExact: total.exact,
        editable: version.status === "draft" && usedBy.length === 0,
        usedByRunIds: usedBy,
        version: version.version,
        shares: own.map((share) => ({
          id: share.id,
          unitId: share.unitId,
          buildingId: share.buildingId,
          label: share.unitId
            ? (labels.get(share.unitId) ?? "—")
            : (buildingName.get(share.buildingId ?? "") ?? "—"),
          share: share.share,
        })),
      };
    }),
  });
}

async function writeShares(
  tx: Tx,
  organizationId: string,
  keyVersionId: string,
  shares: readonly {
    unitId?: string | undefined;
    buildingId?: string | undefined;
    share: string;
  }[],
): Promise<void> {
  for (const share of shares) {
    if ((share.unitId === undefined) === (share.buildingId === undefined)) {
      ruleViolation("Une part porte soit un lot, soit un immeuble (CHA-01).");
    }
  }
  await tx
    .delete(tables.chargeAllocationShare)
    .where(eq(tables.chargeAllocationShare.keyVersionId, keyVersionId));
  await tx.insert(tables.chargeAllocationShare).values(
    shares.map((share) => ({
      organizationId,
      keyVersionId,
      unitId: share.unitId ?? null,
      buildingId: share.buildingId ?? null,
      share: share.share,
    })),
  );
}

function keyOf(version: KeyVersionRow, shares: readonly ShareRow[]): AllocationKey {
  return {
    version: version.sequence,
    shares: shares
      .filter((share) => share.unitId !== null)
      .map((share) => ({ lotId: share.unitId as string, share: share.share })),
  };
}

type RunRow = typeof tables.provisionRegularizationRun.$inferSelect;

type Computation = {
  postings: RunPostingRead[];
  lines: RunLineRead[];
  excluded: RunExclusionRead[];
  keyVersionIds: string[];
  totalRecoverable: string;
  totalProvisionsCalled: string;
  totalOwnerShare: string;
  netBalance: string;
  unpaidProvisions: string;
  blockedReason: string | null;
  missing: string[];
};

const EMPTY_COMPUTATION: Omit<Computation, "blockedReason" | "missing"> = {
  postings: [],
  lines: [],
  excluded: [],
  keyVersionIds: [],
  totalRecoverable: "0.00",
  totalProvisionsCalled: "0.00",
  totalOwnerShare: "0.00",
  netBalance: "0.00",
  unpaidProvisions: "0.00",
};

function blockedComputation(reason: string, missing: string[]): Computation {
  return { ...EMPTY_COMPUTATION, blockedReason: reason, missing };
}

/** CHA-01/CHA-02: the live computation, run only while the run is still open. */
async function computeLive(tx: Tx, run: RunRow): Promise<Computation> {
  const buildings = await tx
    .select({ id: tables.building.id })
    .from(tables.building)
    .where(
      run.buildingId
        ? eq(tables.building.id, run.buildingId)
        : eq(tables.building.legalEntityId, run.legalEntityId),
    );
  const buildingIds = buildings.map((row) => row.id);
  if (buildingIds.length === 0) return blockedComputation("no_building_in_scope", []);

  const units = await tx
    .select({ id: tables.unit.id, code: tables.unit.code, label: tables.unit.label })
    .from(tables.unit)
    .where(inArray(tables.unit.buildingId, buildingIds));
  const unitIds = units.map((row) => row.id);
  const unitLabel = new Map(units.map((row) => [row.id, `${row.code} — ${row.label}`]));
  if (unitIds.length === 0) return blockedComputation("no_unit_in_scope", []);

  const allocations = await tx
    .select({
      id: tables.expenseAllocation.id,
      target: tables.expenseAllocation.target,
      unitId: tables.expenseAllocation.unitId,
      buildingId: tables.expenseAllocation.buildingId,
      legalEntityId: tables.expenseAllocation.legalEntityId,
      recoverableAmount: tables.expenseAllocation.recoverableAmount,
      keyVersionId: tables.expenseAllocation.keyVersionId,
      description: tables.expenseLine.description,
      chargeNature: tables.expenseLine.chargeNature,
      lineKeyVersionId: tables.expenseLine.allocationKeyVersionId,
    })
    .from(tables.expenseAllocation)
    .innerJoin(
      tables.expenseLine,
      eq(tables.expenseAllocation.expenseLineId, tables.expenseLine.id),
    )
    .innerJoin(tables.expense, eq(tables.expenseLine.expenseId, tables.expense.id))
    .where(
      and(
        eq(tables.expense.legalEntityId, run.legalEntityId),
        inArray(tables.expense.status, ["validated", "posted", "paid", "reconciled"]),
        sql`${tables.expenseAllocation.recoverableAmount} > 0`,
        sql`coalesce(${tables.expenseLine.servicePeriodStart}, ${tables.expense.issuedOn}) <= ${run.periodEnd}`,
        sql`coalesce(${tables.expenseLine.servicePeriodEnd}, ${tables.expense.issuedOn}) >= ${run.periodStart}`,
      ),
    )
    .orderBy(asc(tables.expenseAllocation.id));

  const inScope = allocations.filter((row) =>
    row.target === "unit"
      ? row.unitId !== null && unitIds.includes(row.unitId)
      : row.target === "building_common"
        ? row.buildingId !== null && buildingIds.includes(row.buildingId)
        : run.buildingId === null,
  );

  const keyVersions = await tx
    .select()
    .from(tables.chargeAllocationKeyVersion)
    .orderBy(asc(tables.chargeAllocationKeyVersion.sequence));
  const keyRows = await tx.select().from(tables.chargeAllocationKey);
  const allShares = await tx.select().from(tables.chargeAllocationShare);
  const keyById = new Map(keyRows.map((row) => [row.id, row]));

  function defaultKeyVersion(row: (typeof inScope)[number]): KeyVersionRow | undefined {
    const candidates = keyVersions.filter((version) => {
      const key = keyById.get(version.allocationKeyId);
      if (!key || version.status !== "active") return false;
      if (version.effectiveFrom > run.periodStart) return false;
      return row.target === "building_common"
        ? key.buildingId === row.buildingId
        : key.legalEntityId === run.legalEntityId;
    });
    return candidates.at(-1);
  }

  const postings: RunPostingRead[] = [];
  const spreadInput: ChargePosting[] = [];
  const usedKeyVersions = new Set<string>();
  const keyVersionByCharge = new Map<string, KeyVersionRow>();

  for (const row of inScope) {
    if (row.target === "unit" && row.unitId) {
      spreadInput.push({
        chargeId: row.id,
        label: row.description,
        recoverableAmount: amount(row.recoverableAmount),
        lotId: row.unitId,
      });
      continue;
    }
    const versionId = row.keyVersionId ?? row.lineKeyVersionId;
    const version = versionId
      ? keyVersions.find((candidate) => candidate.id === versionId)
      : defaultKeyVersion(row);
    if (!version) return blockedComputation("missing_allocation_key", [row.description]);
    const shares = allShares.filter((share) => share.keyVersionId === version.id);
    if (shares.length === 0 || shares.some((share) => share.unitId === null)) {
      return blockedComputation("key_not_unit_scoped", [row.description]);
    }
    usedKeyVersions.add(version.id);
    keyVersionByCharge.set(row.id, version);
    spreadInput.push({
      chargeId: row.id,
      label: row.description,
      recoverableAmount: amount(row.recoverableAmount),
      key: keyOf(version, shares),
    });
  }

  const occupancyRows = await tx
    .select({
      leaseId: tables.leaseUnit.leaseId,
      unitId: tables.leaseUnit.unitId,
      startsOn: tables.leaseUnit.startsOn,
      endsOn: tables.leaseUnit.endsOn,
      reference: tables.lease.reference,
      chargeRegime: tables.lease.chargeRegime,
      currency: tables.lease.currency,
    })
    .from(tables.leaseUnit)
    .innerJoin(tables.lease, eq(tables.leaseUnit.leaseId, tables.lease.id))
    .where(
      and(
        inArray(tables.leaseUnit.unitId, unitIds),
        sql`${tables.leaseUnit.startsOn} <= ${run.periodEnd}`,
        or(isNull(tables.leaseUnit.endsOn), sql`${tables.leaseUnit.endsOn} >= ${run.periodStart}`),
      ),
    )
    .orderBy(asc(tables.leaseUnit.startsOn));

  const occupancies: RegularisationOccupancy[] = occupancyRows.map((row) => ({
    lotId: row.unitId,
    tenantId: row.leaseId,
    start: row.startsOn < run.periodStart ? run.periodStart : row.startsOn,
    end: row.endsOn === null || row.endsOn > run.periodEnd ? run.periodEnd : row.endsOn,
  }));

  const spread = spreadRecoverableCharges({
    period: { start: run.periodStart, end: run.periodEnd },
    postings: spreadInput,
    occupancies,
  });
  if (!spread.ok) return blockedComputation(spread.reason, spread.missing ?? []);

  const byId = new Map(inScope.map((row) => [row.id, row]));
  for (const posting of spread.postings) {
    const source = byId.get(posting.chargeId);
    const version = keyVersionByCharge.get(posting.chargeId);
    const keyRow = version ? keyById.get(version.allocationKeyId) : undefined;
    postings.push({
      chargeId: posting.chargeId,
      label: posting.label,
      chargeNature: source?.chargeNature ?? null,
      recoverableAmount: posting.recoverableAmount,
      keyVersionId: version?.id ?? null,
      keyLabel: keyRow?.label ?? null,
      keyVersionSequence: posting.keyVersion,
      lots: posting.lots.map(
        (lot): SpreadLotRead => ({
          unitId: lot.lotId,
          unitLabel: unitLabel.get(lot.lotId) ?? "—",
          amount: lot.amount,
          periodDays: lot.periodDays,
          vacancyDays: lot.vacancyDays,
          ownerAmount: lot.ownerAmount,
          tenants: lot.tenants.map((entry) => ({
            leaseId: entry.tenantId,
            leaseReference:
              occupancyRows.find((row) => row.leaseId === entry.tenantId)?.reference ?? "—",
            days: entry.days,
            amount: entry.amount,
          })),
        }),
      ),
    });
  }

  const leaseIds = [...new Set(occupancyRows.map((row) => row.leaseId))];
  const provisions = await provisionsPerLease(tx, leaseIds, run);
  const holders = await holderNames(tx, leaseIds);
  const periodDays = daysBetween(run.periodStart, run.periodEnd);
  const occupancyOf = (leaseId: string) =>
    occupancies.filter((occupancy) => occupancy.tenantId === leaseId);

  const regularised = regulariseProvisions(
    spread.byTenant.map((entry) => {
      const lease = occupancyRows.find((row) => row.leaseId === entry.tenantId);
      const called = provisions.get(entry.tenantId);
      return {
        tenantId: entry.tenantId,
        recoverableCost: entry.amount,
        provisionsCalled: called?.called ?? "0.00",
        provisionsPaid: called?.paid ?? "0.00",
        kind: lease?.chargeRegime === "provision" ? ("provision" as const) : ("flat" as const),
      };
    }),
  );

  const excluded: RunExclusionRead[] = spread.byTenant
    .filter((entry) => {
      const regime = occupancyRows.find((row) => row.leaseId === entry.tenantId)?.chargeRegime;
      return regime !== "provision";
    })
    .map((entry) => {
      const lease = occupancyRows.find((row) => row.leaseId === entry.tenantId);
      return {
        leaseId: entry.tenantId,
        leaseReference: lease?.reference ?? "—",
        reason:
          lease?.chargeRegime === "flat_fee"
            ? ("flat_fee" as const)
            : ("no_charge_regime" as const),
        amount: entry.amount,
      };
    });

  const lines: RunLineRead[] = [];
  for (const line of regularised.lines) {
    const own = occupancyOf(line.tenantId);
    const lot = own[0]?.lotId;
    if (!lot) continue;
    const lease = occupancyRows.find((row) => row.leaseId === line.tenantId);
    lines.push({
      leaseId: line.tenantId,
      leaseReference: lease?.reference ?? "—",
      tenantName: holders.get(line.tenantId) ?? lease?.reference ?? "—",
      unitId: lot,
      unitLabel: unitLabel.get(lot) ?? "—",
      occupancyDays: own.reduce(
        (acc, occupancy) => acc + daysBetween(occupancy.start, occupancy.end),
        0,
      ),
      periodDays,
      recoverableAmount: line.recoverableCost,
      provisionsCalled: line.provisionsCalled,
      provisionsPaid: line.provisionsPaid,
      provisionsUnpaid: line.unpaidProvisions,
      balanceAmount: line.balance,
      totalReceivable: line.totalReceivable,
      direction: line.direction,
      currency: lease?.currency ?? run.currency,
      resultingRentTermId: null,
      statementDocumentId: null,
    });
  }

  return {
    postings,
    lines,
    excluded,
    keyVersionIds: [...usedKeyVersions],
    totalRecoverable: sumAmounts(lines.map((line) => line.recoverableAmount)),
    totalProvisionsCalled: sumAmounts(lines.map((line) => line.provisionsCalled)),
    totalOwnerShare: spread.ownerAmount,
    netBalance: regularised.netBalance,
    unpaidProvisions: regularised.unpaidProvisions,
    blockedReason: null,
    missing: [],
  };
}

async function provisionsPerLease(
  tx: Tx,
  leaseIds: string[],
  run: RunRow,
): Promise<Map<string, { called: string; paid: string }>> {
  if (leaseIds.length === 0) return new Map();
  const rows = await tx
    .select({
      leaseId: tables.rentTerm.leaseId,
      rentAmount: tables.rentTermVersion.rentAmount,
      chargeAmount: tables.rentTermVersion.chargeAmount,
      paid: sql<string>`coalesce((
        SELECT sum(pa.amount) FROM payment_allocation pa
        WHERE pa.rent_term_id = ${tables.rentTerm.id} AND pa.reversed_at IS NULL
      ), 0)::text`,
    })
    .from(tables.rentTerm)
    .innerJoin(
      tables.rentTermVersion,
      eq(tables.rentTerm.currentVersionId, tables.rentTermVersion.id),
    )
    .where(
      and(
        inArray(tables.rentTerm.leaseId, leaseIds),
        inArray(tables.rentTerm.kind, ["rent", "charge_provision"]),
        sql`${tables.rentTerm.periodStart} <= ${run.periodEnd}`,
        sql`${tables.rentTerm.periodEnd} >= ${run.periodStart}`,
      ),
    );

  const out = new Map<string, { called: string; paid: string }>();
  for (const row of rows) {
    const current = out.get(row.leaseId) ?? { called: "0.00", paid: "0.00" };
    const charge = money(amount(row.chargeAmount));
    const rent = money(amount(row.rentAmount));
    const settled = money(amount(row.paid));
    // LOY-02: a payment settles the rent first; only the rest reaches the provisions.
    const toRent = settled.greaterThan(rent) ? rent : settled;
    const rest = settled.minus(toRent);
    const toCharges = rest.greaterThan(charge) ? charge : rest;
    out.set(row.leaseId, {
      called: sumAmounts([current.called, toMoney(charge)]),
      paid: sumAmounts([current.paid, toMoney(toCharges)]),
    });
  }
  return out;
}

async function holderNames(tx: Tx, leaseIds: string[]): Promise<Map<string, string>> {
  if (leaseIds.length === 0) return new Map();
  const rows = await tx
    .select({
      leaseId: tables.leaseParty.leaseId,
      role: tables.leaseParty.role,
      name: tables.person.displayName,
    })
    .from(tables.leaseParty)
    .innerJoin(tables.person, eq(tables.leaseParty.personId, tables.person.id))
    .where(inArray(tables.leaseParty.leaseId, leaseIds))
    .orderBy(asc(tables.leaseParty.startsOn));
  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.role !== "holder" && row.role !== "co_holder") continue;
    if (!out.has(row.leaseId)) out.set(row.leaseId, row.name);
  }
  return out;
}

async function frozenComputation(tx: Tx, run: RunRow): Promise<Computation | null> {
  const rows = await tx
    .select({ payload: tables.event.payload })
    .from(tables.event)
    .where(eq(tables.event.type, FROZEN_EVENT));
  const snapshot = rows
    .map((row) => row.payload as ({ runId?: string } & Computation) | null)
    .find((payload) => payload?.runId === run.id);
  if (!snapshot) return null;

  const lines = await tx
    .select()
    .from(tables.provisionRegularizationLine)
    .where(eq(tables.provisionRegularizationLine.runId, run.id));
  const byLease = new Map(lines.map((line) => [line.leaseId, line]));
  return {
    ...snapshot,
    lines: snapshot.lines.map((line) => ({
      ...line,
      resultingRentTermId: byLease.get(line.leaseId)?.resultingRentTermId ?? null,
    })),
  };
}

async function readRun(tx: Tx, runId: string): Promise<RegularizationRunRead> {
  const run = firstOr(
    await tx
      .select()
      .from(tables.provisionRegularizationRun)
      .where(eq(tables.provisionRegularizationRun.id, runId))
      .limit(1),
    "Régularisation",
  );
  const frozen = run.frozenAt === null ? null : await frozenComputation(tx, run);
  const computation = frozen ?? (await computeLive(tx, run));

  const entity = firstOr(
    await tx
      .select({ name: tables.legalEntity.name })
      .from(tables.legalEntity)
      .where(eq(tables.legalEntity.id, run.legalEntityId))
      .limit(1),
    "SCI",
  );
  const building = run.buildingId
    ? (
        await tx
          .select({ name: tables.building.name })
          .from(tables.building)
          .where(eq(tables.building.id, run.buildingId))
          .limit(1)
      )[0]
    : undefined;

  return RegularizationRunRead.parse({
    id: run.id,
    legalEntityId: run.legalEntityId,
    legalEntityName: entity.name,
    buildingId: run.buildingId,
    buildingName: building?.name ?? null,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status,
    frozenAt: instant(run.frozenAt),
    currency: run.currency,
    totalRecoverable: computation.totalRecoverable,
    totalProvisionsCalled: computation.totalProvisionsCalled,
    totalOwnerShare: computation.totalOwnerShare,
    netBalance: computation.netBalance,
    unpaidProvisions: computation.unpaidProvisions,
    postings: computation.postings,
    lines: computation.lines,
    excluded: computation.excluded,
    blockedReason: computation.blockedReason,
    missing: computation.missing,
    source: frozen ? "frozen" : "live",
    version: run.version,
  });
}

async function openRun(tx: Tx, id: string, expectedVersion: number): Promise<RunRow> {
  const run = firstOr(
    await tx
      .select()
      .from(tables.provisionRegularizationRun)
      .where(eq(tables.provisionRegularizationRun.id, id))
      .limit(1),
    "Régularisation",
  );
  if (run.version !== expectedVersion) versionConflict("La régularisation");
  return run;
}

export const chargesRouter = {
  charges: {
    keys: {
      list: withOrganization.charges.keys.list.handler(({ context, input }) =>
        tenant(scope(context), async (tx) => {
          const filters = [
            input.legalEntityId
              ? eq(tables.chargeAllocationKey.legalEntityId, input.legalEntityId)
              : undefined,
            input.buildingId
              ? eq(tables.chargeAllocationKey.buildingId, input.buildingId)
              : undefined,
          ].filter((clause) => clause !== undefined);
          const rows = await tx
            .select({ id: tables.chargeAllocationKey.id })
            .from(tables.chargeAllocationKey)
            .where(filters.length > 0 ? and(...filters) : undefined)
            .orderBy(asc(tables.chargeAllocationKey.code));
          const items = [];
          for (const row of rows) items.push(await readKey(tx, row.id));
          return { items };
        }),
      ),

      get: withOrganization.charges.keys.get
        .use(validated(AllocationKeyRead))
        .handler(({ context, input }) => tenant(scope(context), (tx) => readKey(tx, input.id))),

      create: withOrganization.charges.keys.create
        .use(validated(AllocationKeyRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => createKey(tx, actorOf(context), input)),
        ),

      addVersion: withOrganization.charges.keys.addVersion
        .use(validated(AllocationKeyRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => addVersion(tx, actorOf(context), input)),
        ),

      updateVersion: withOrganization.charges.keys.updateVersion
        .use(validated(AllocationKeyRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => updateVersion(tx, actorOf(context), input)),
        ),

      activate: withOrganization.charges.keys.activate
        .use(validated(AllocationKeyRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => activateVersion(tx, actorOf(context), input)),
        ),

      retire: withOrganization.charges.keys.retire
        .use(validated(AllocationKeyRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => {
            const key = firstOr(
              await tx
                .select()
                .from(tables.chargeAllocationKey)
                .where(eq(tables.chargeAllocationKey.id, input.id))
                .limit(1),
              "Clé de répartition",
            );
            if (key.version !== input.expectedVersion) versionConflict("La clé");
            await tx
              .update(tables.chargeAllocationKey)
              .set({
                status: "retired",
                version: key.version + 1,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(tables.chargeAllocationKey.id, key.id));
            await audit(tx, actorOf(context), {
              objectTable: "charge_allocation_key",
              objectId: key.id,
              action: "retire",
              before: { status: key.status },
              after: { status: "retired" },
            });
            return readKey(tx, key.id);
          }),
        ),
    },

    runs: {
      list: withOrganization.charges.runs.list.handler(({ context, input }) =>
        tenant(scope(context), async (tx) => {
          const rows = await tx
            .select()
            .from(tables.provisionRegularizationRun)
            .where(
              input.legalEntityId
                ? eq(tables.provisionRegularizationRun.legalEntityId, input.legalEntityId)
                : undefined,
            )
            .orderBy(asc(tables.provisionRegularizationRun.periodStart));
          const entities = await tx
            .select({ id: tables.legalEntity.id, name: tables.legalEntity.name })
            .from(tables.legalEntity);
          const buildings = await tx
            .select({ id: tables.building.id, name: tables.building.name })
            .from(tables.building);
          const entityName = new Map(entities.map((row) => [row.id, row.name]));
          const buildingName = new Map(buildings.map((row) => [row.id, row.name]));
          return {
            items: rows.map(
              (row): RunSummaryRead => ({
                id: row.id,
                legalEntityName: entityName.get(row.legalEntityId) ?? "—",
                buildingName: row.buildingId ? (buildingName.get(row.buildingId) ?? null) : null,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                status: row.status as RunSummaryRead["status"],
                frozenAt: instant(row.frozenAt),
                totalRecoverable: row.totalRecoverable ? amount(row.totalRecoverable) : null,
                totalProvisionsCalled: row.totalProvisionsCalled
                  ? amount(row.totalProvisionsCalled)
                  : null,
                currency: row.currency,
              }),
            ),
          };
        }),
      ),

      get: withOrganization.charges.runs.get
        .use(validated(RegularizationRunRead))
        .handler(({ context, input }) => tenant(scope(context), (tx) => readRun(tx, input.id))),

      create: withOrganization.charges.runs.create
        .use(validated(RegularizationRunRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => createRun(tx, actorOf(context), input)),
        ),

      compute: withOrganization.charges.runs.compute
        .use(validated(RegularizationRunRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => {
            const run = await openRun(tx, input.id, input.expectedVersion);
            if (run.frozenAt !== null) {
              ruleViolation("La régularisation est gelée : son calcul ne se rejoue pas (WF-07).");
            }
            const computation = await computeLive(tx, run);
            await tx
              .update(tables.provisionRegularizationRun)
              .set({
                status: computation.blockedReason ? "draft" : "computed",
                totalRecoverable: computation.totalRecoverable,
                totalProvisionsCalled: computation.totalProvisionsCalled,
                totalOwnerShare: computation.totalOwnerShare,
                version: run.version + 1,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(tables.provisionRegularizationRun.id, run.id));
            await audit(tx, actorOf(context), {
              objectTable: "provision_regularization_run",
              objectId: run.id,
              action: "compute",
              after: {
                totalRecoverable: computation.totalRecoverable,
                blockedReason: computation.blockedReason,
              },
            });
            return readRun(tx, run.id);
          }),
        ),

      freeze: withOrganization.charges.runs.freeze
        .use(validated(RegularizationRunRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => freezeRun(tx, actorOf(context), input)),
        ),

      close: withOrganization.charges.runs.close
        .use(validated(CloseRunResult))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => closeRun(tx, actorOf(context), input)),
        ),

      statement: withOrganization.charges.runs.statement
        .use(validated(StatementResult))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => issueStatement(tx, actorOf(context), input)),
        ),

      cancel: withOrganization.charges.runs.cancel
        .use(validated(RegularizationRunRead))
        .handler(({ context, input }) =>
          tenant(scope(context), async (tx) => {
            const run = await openRun(tx, input.id, input.expectedVersion);
            if (run.status === "posted") {
              ruleViolation("Une régularisation comptabilisée ne s’annule pas ici.");
            }
            await tx
              .update(tables.provisionRegularizationRun)
              .set({
                status: "cancelled",
                version: run.version + 1,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(tables.provisionRegularizationRun.id, run.id));
            await audit(tx, actorOf(context), {
              objectTable: "provision_regularization_run",
              objectId: run.id,
              action: "cancel",
              before: { status: run.status },
              after: { status: "cancelled" },
            });
            return readRun(tx, run.id);
          }),
        ),
    },
  },
};

type Actor = { organizationId: string; actorUserId: string | null };

async function createKey(
  tx: Tx,
  actor: Actor,
  input: CreateAllocationKeyInput,
): Promise<AllocationKeyRead> {
  if ((input.buildingId === undefined) === (input.legalEntityId === undefined)) {
    ruleViolation("Une clé porte soit un immeuble, soit une SCI (CHA-01).");
  }
  const key = firstOr(
    await tx
      .insert(tables.chargeAllocationKey)
      .values({
        organizationId: actor.organizationId,
        buildingId: input.buildingId ?? null,
        legalEntityId: input.legalEntityId ?? null,
        code: input.code,
        label: input.label,
        basis: input.basis,
        status: "draft",
      })
      .returning(),
    "Clé de répartition",
  );
  const version = firstOr(
    await tx
      .insert(tables.chargeAllocationKeyVersion)
      .values({
        organizationId: actor.organizationId,
        allocationKeyId: key.id,
        sequence: 1,
        effectiveFrom: input.effectiveFrom,
        roundingRule: input.roundingRule ?? "largest_remainder",
        justification: input.justification ?? null,
        status: "draft",
      })
      .returning(),
    "Version de clé",
  );
  await writeShares(tx, actor.organizationId, version.id, input.shares);
  await audit(tx, actor, {
    objectTable: "charge_allocation_key",
    objectId: key.id,
    action: "create",
    after: { code: key.code, basis: key.basis, sequence: 1 },
  });
  return readKey(tx, key.id);
}

async function addVersion(
  tx: Tx,
  actor: Actor,
  input: AddKeyVersionInput,
): Promise<AllocationKeyRead> {
  const existing = await tx
    .select({ sequence: tables.chargeAllocationKeyVersion.sequence })
    .from(tables.chargeAllocationKeyVersion)
    .where(eq(tables.chargeAllocationKeyVersion.allocationKeyId, input.keyId));
  if (existing.length === 0) notFound("Clé de répartition");
  const sequence = existing.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
  const version = firstOr(
    await tx
      .insert(tables.chargeAllocationKeyVersion)
      .values({
        organizationId: actor.organizationId,
        allocationKeyId: input.keyId,
        sequence,
        effectiveFrom: input.effectiveFrom,
        roundingRule: input.roundingRule ?? "largest_remainder",
        justification: input.justification ?? null,
        status: "draft",
      })
      .returning(),
    "Version de clé",
  );
  await writeShares(tx, actor.organizationId, version.id, input.shares);
  await audit(tx, actor, {
    objectTable: "charge_allocation_key_version",
    objectId: version.id,
    action: "create",
    after: { sequence, effectiveFrom: input.effectiveFrom },
  });
  return readKey(tx, input.keyId);
}

async function assertEditable(tx: Tx, versionId: string, status: string): Promise<void> {
  if (status !== "draft") {
    ruleViolation("Une version activée ne se modifie plus : créez une nouvelle version (CHA-01).");
  }
  const used = await runsUsingKeyVersions(tx);
  if ((used.get(versionId) ?? []).length > 0) {
    ruleViolation("Cette version a servi à une régularisation gelée ; elle est figée (WF-07).");
  }
}

async function updateVersion(
  tx: Tx,
  actor: Actor,
  input: UpdateKeyVersionInput,
): Promise<AllocationKeyRead> {
  const version = firstOr(
    await tx
      .select()
      .from(tables.chargeAllocationKeyVersion)
      .where(eq(tables.chargeAllocationKeyVersion.id, input.keyVersionId))
      .limit(1),
    "Version de clé",
  );
  if (version.version !== input.expectedVersion) versionConflict("La version de clé");
  await assertEditable(tx, version.id, version.status);

  await tx
    .update(tables.chargeAllocationKeyVersion)
    .set({
      ...(input.effectiveFrom ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(input.justification ? { justification: input.justification } : {}),
      ...(input.roundingRule ? { roundingRule: input.roundingRule } : {}),
      version: version.version + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tables.chargeAllocationKeyVersion.id, version.id));
  if (input.shares) await writeShares(tx, actor.organizationId, version.id, input.shares);

  await audit(tx, actor, {
    objectTable: "charge_allocation_key_version",
    objectId: version.id,
    action: "update",
    after: { shares: input.shares?.length ?? null },
  });
  return readKey(tx, version.allocationKeyId);
}

async function activateVersion(
  tx: Tx,
  actor: Actor,
  input: ActivateKeyVersionInput,
): Promise<AllocationKeyRead> {
  const version = firstOr(
    await tx
      .select()
      .from(tables.chargeAllocationKeyVersion)
      .where(eq(tables.chargeAllocationKeyVersion.id, input.keyVersionId))
      .limit(1),
    "Version de clé",
  );
  if (version.version !== input.expectedVersion) versionConflict("La version de clé");
  if (version.status !== "draft") ruleViolation("Cette version est déjà activée.");

  const shares = await tx
    .select()
    .from(tables.chargeAllocationShare)
    .where(eq(tables.chargeAllocationShare.keyVersionId, version.id));
  const total = allocationKeyTotal(shares.map((share) => ({ share: share.share })));
  if (!total.exact) {
    ruleViolation(
      `Les parts totalisent ${total.total} au lieu de 1 : une clé active répartit exactement 100 % (CHA-01).`,
    );
  }

  const stamp = new Date().toISOString();
  const siblings = await tx
    .select()
    .from(tables.chargeAllocationKeyVersion)
    .where(
      and(
        eq(tables.chargeAllocationKeyVersion.allocationKeyId, version.allocationKeyId),
        eq(tables.chargeAllocationKeyVersion.status, "active"),
      ),
    );
  for (const sibling of siblings) {
    await tx
      .update(tables.chargeAllocationKeyVersion)
      .set({
        status: "superseded",
        effectiveTo: version.effectiveFrom,
        version: sibling.version + 1,
        updatedAt: stamp,
      })
      .where(eq(tables.chargeAllocationKeyVersion.id, sibling.id));
  }

  await tx
    .update(tables.chargeAllocationKeyVersion)
    .set({
      status: "active",
      approvedAt: stamp,
      ...(actor.actorUserId ? { approvedBy: actor.actorUserId } : {}),
      version: version.version + 1,
      updatedAt: stamp,
    })
    .where(eq(tables.chargeAllocationKeyVersion.id, version.id));
  await tx
    .update(tables.chargeAllocationKey)
    .set({ status: "active", updatedAt: stamp })
    .where(eq(tables.chargeAllocationKey.id, version.allocationKeyId));

  await audit(tx, actor, {
    objectTable: "charge_allocation_key_version",
    objectId: version.id,
    action: "activate",
    after: { sharesTotal: total.total, supersedes: siblings.map((row) => row.id) },
  });
  return readKey(tx, version.allocationKeyId);
}

async function createRun(
  tx: Tx,
  actor: Actor,
  input: CreateRunInput,
): Promise<RegularizationRunRead> {
  if (input.periodEnd <= input.periodStart) {
    ruleViolation("La période de régularisation doit se terminer après son début.");
  }
  const run = firstOr(
    await tx
      .insert(tables.provisionRegularizationRun)
      .values({
        organizationId: actor.organizationId,
        legalEntityId: input.legalEntityId,
        buildingId: input.buildingId ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: "draft",
      })
      .returning(),
    "Régularisation",
  );
  await audit(tx, actor, {
    objectTable: "provision_regularization_run",
    objectId: run.id,
    action: "create",
    after: { periodStart: run.periodStart, periodEnd: run.periodEnd },
  });
  return readRun(tx, run.id);
}

/** WF-07: freezing writes the computation down; nothing recomputes it afterwards. */
async function freezeRun(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number },
): Promise<RegularizationRunRead> {
  const run = await openRun(tx, input.id, input.expectedVersion);
  if (run.frozenAt !== null) ruleViolation("La régularisation est déjà gelée.");

  const computation = await computeLive(tx, run);
  if (computation.blockedReason) {
    throw new AppError("RULE_VIOLATION", {
      message: "Le calcul est bloqué ; complétez les éléments manquants avant de geler.",
      details: { reason: computation.blockedReason, missing: computation.missing },
    });
  }
  if (computation.lines.length === 0) {
    ruleViolation("Aucun occupant à régulariser sur cette période.");
  }

  const stamp = new Date().toISOString();
  for (const line of computation.lines) {
    await tx
      .insert(tables.provisionRegularizationLine)
      .values({
        organizationId: actor.organizationId,
        runId: run.id,
        leaseId: line.leaseId,
        unitId: line.unitId,
        occupancyDays: line.occupancyDays,
        periodDays: line.periodDays,
        recoverableAmount: line.recoverableAmount,
        provisionsCalled: line.provisionsCalled,
        provisionsUnpaid: line.provisionsUnpaid,
        balanceAmount: line.balanceAmount,
        currency: line.currency,
      })
      .onConflictDoNothing();
  }

  await tx
    .update(tables.provisionRegularizationRun)
    .set({
      status: "frozen",
      frozenAt: stamp,
      totalRecoverable: computation.totalRecoverable,
      totalProvisionsCalled: computation.totalProvisionsCalled,
      totalOwnerShare: computation.totalOwnerShare,
      version: run.version + 1,
      updatedAt: stamp,
    })
    .where(eq(tables.provisionRegularizationRun.id, run.id));

  await recordFact(tx, actor, {
    kind: "legal_entity",
    id: run.legalEntityId,
    type: FROZEN_EVENT,
    payload: { runId: run.id, ...computation },
  });
  await audit(tx, actor, {
    objectTable: "provision_regularization_run",
    objectId: run.id,
    action: "freeze",
    after: { frozenAt: stamp, lines: computation.lines.length },
  });
  return readRun(tx, run.id);
}

/**
 * CHA-02 / ARC-02: the adjustment is the difference against the provisions
 * CALLED; provisions called and unpaid stay in the tenant account and are never
 * re-invoiced here. Nothing is sent — the approval flow authorises the command.
 */
async function closeRun(
  tx: Tx,
  actor: Actor,
  input: { id: string; expectedVersion: number },
): Promise<CloseRunResult> {
  const run = await openRun(tx, input.id, input.expectedVersion);
  if (run.frozenAt === null) ruleViolation("Gelez la régularisation avant de la clôturer (WF-07).");
  // Statements may go out before the adjustments are prepared, which moves the
  // run to `sent`; both states still have their ajustements to prepare.
  if (run.status !== "frozen" && run.status !== "sent") {
    ruleViolation("La régularisation n’est plus à clôturer.");
  }

  const view = await readRun(tx, run.id);
  const dueOn = addDays(today(), STATEMENT_DUE_DAYS);
  const commands: CloseRunResult["commands"] = [];

  for (const line of view.lines) {
    if (line.balanceAmount === "0.00") continue;
    const credit = line.balanceAmount.startsWith("-");
    const kind = credit ? "credit_note" : "charge_regularization";
    const term = firstOr(
      await tx
        .insert(tables.rentTerm)
        .values({
          organizationId: actor.organizationId,
          leaseId: line.leaseId,
          kind,
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          dueOn,
          status: "authorized",
          regularizationRunId: run.id,
        })
        .returning(),
      "Terme de régularisation",
    );
    const version = firstOr(
      await tx
        .insert(tables.rentTermVersion)
        .values({
          organizationId: actor.organizationId,
          rentTermId: term.id,
          sequence: 1,
          rentAmount: "0",
          chargeAmount: line.balanceAmount,
          accessoryAmount: "0",
          totalAmount: line.balanceAmount,
          currency: line.currency,
          reason: "regularization",
        })
        .returning(),
      "Version du terme",
    );
    await tx
      .update(tables.rentTerm)
      .set({ currentVersionId: version.id })
      .where(eq(tables.rentTerm.id, term.id));
    await tx
      .update(tables.provisionRegularizationLine)
      .set({ resultingRentTermId: term.id, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(tables.provisionRegularizationLine.runId, run.id),
          eq(tables.provisionRegularizationLine.leaseId, line.leaseId),
        ),
      );

    const payload = {
      rentTermId: term.id,
      kind,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      dueOn,
      rentAmount: "0.00",
      chargeAmount: line.balanceAmount,
      accessoryAmount: "0.00",
      totalAmount: line.balanceAmount,
      currency: line.currency,
    };
    const objectRefId = await ensureObjectRef(tx, {
      organizationId: actor.organizationId,
      kind: "rent_term",
      id: term.id,
    });
    const command = await createCommand(tx, {
      organizationId: actor.organizationId,
      commandType: "prepare_rent_accounting",
      operationKey: operationKey("prepare_rent_accounting", term.id),
      payload,
      payloadHash: hashPayload(payload),
      targetObjectRefId: objectRefId,
      expectedVersion: term.version,
      actorUserId: actor.actorUserId,
      autonomyLevel: decisionLevelByCommand.prepare_rent_accounting,
      status: "prepared",
    });
    commands.push({ leaseId: line.leaseId, commandId: command.id, amount: line.balanceAmount });
  }

  await tx
    .update(tables.provisionRegularizationRun)
    .set({ status: "approved", version: run.version + 1, updatedAt: new Date().toISOString() })
    .where(eq(tables.provisionRegularizationRun.id, run.id));
  await audit(tx, actor, {
    objectTable: "provision_regularization_run",
    objectId: run.id,
    action: "close",
    after: { commands: commands.length },
  });

  return {
    run: await readRun(tx, run.id),
    commands,
    decisionLevel: decisionLevelByCommand.prepare_rent_accounting,
  };
}

/** CHA-02: the individual statement is rendered from what the run froze. */
async function issueStatement(
  tx: Tx,
  actor: Actor,
  input: { id: string; leaseId: string },
): Promise<StatementResult> {
  const run = firstOr(
    await tx
      .select()
      .from(tables.provisionRegularizationRun)
      .where(eq(tables.provisionRegularizationRun.id, input.id))
      .limit(1),
    "Régularisation",
  );
  if (run.frozenAt === null) {
    ruleViolation("Gelez la régularisation avant d’éditer un décompte (WF-07).");
  }
  const view = await readRun(tx, run.id);
  const line = view.lines.find((candidate) => candidate.leaseId === input.leaseId);
  if (!line) notFound("Ligne de régularisation");

  const document = firstOr(
    await tx
      .insert(tables.document)
      .values({
        organizationId: actor.organizationId,
        title: `Décompte de charges ${run.periodStart} — ${line.leaseReference}`,
        nature: "charge_statement",
        confidentiality: "public_to_tenant",
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        status: "uploading",
      })
      .returning(),
    "Document",
  );
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: actor.organizationId,
    kind: "lease",
    id: line.leaseId,
  });
  await tx
    .insert(tables.documentLink)
    .values({
      organizationId: actor.organizationId,
      documentId: document.id,
      objectRefId,
      relation: "report",
    })
    .onConflictDoNothing();

  const jobId = await enqueueJob("pdf.render", {
    organizationId: actor.organizationId,
    template: "decompte",
    documentId: document.id,
    regularizationRunId: run.id,
    leaseId: line.leaseId,
  });

  if (run.status === "approved" || run.status === "frozen") {
    await tx
      .update(tables.provisionRegularizationRun)
      .set({ status: "sent", updatedAt: new Date().toISOString() })
      .where(eq(tables.provisionRegularizationRun.id, run.id));
  }
  await audit(tx, actor, {
    objectTable: "provision_regularization_run",
    objectId: run.id,
    action: "statement",
    after: { leaseId: line.leaseId, documentId: document.id },
  });

  return { documentId: document.id, jobId, run: await readRun(tx, run.id) };
}
