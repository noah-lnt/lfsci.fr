import "server-only";
import {
  CommandEnvelope,
  type CreatePersonInput,
  decisionLevelByCommand,
  type LeaseStatus,
  type PersonKind,
} from "@lfsci/contracts";
import { createCommand, hashPayload, type Tx, tables } from "@lfsci/db";
import {
  allocatePayment,
  generateRentTerms,
  type LeaseTerms,
  proposeRevision,
  type RentVersion,
  type RevisionProposal,
} from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import {
  AllocateResult,
  DepositRead,
  GenerateTermsResult,
  LeaseDetail,
  LeasePage,
  PaymentPage,
  PaymentRead,
  PersonDetail,
  PersonPage,
  ReceiptPage,
  ReceiptRead,
  RentTermPage,
  RevisionProposalRead,
  UnitOptions,
} from "@/lib/contracts/locations";
import { tenant } from "../../data";
import {
  allowedTransitions,
  decodeCursor,
  encodeCursor,
  outstandingOf,
  receiptKindOf,
  splitOnRentFirst,
  sumMoney,
  usageForLeaseKind,
} from "../../locations/mappers";
import {
  depositFor,
  leaseDetail,
  leaseListItems,
  leaseRow,
  paymentsForLease,
  personDetail,
  receiptsForLease,
  termsForLeases,
} from "../../locations/queries";
import { audit, emitEvent } from "../../locations/trace";
import { enqueueJob } from "../../queue";
import { validated, withOrganization } from "../base";

/** Fixed namespace: a command's operation key is derived from its object, never random. */
const OPERATION_NAMESPACE = "6f1c2b2e-2c7f-4c4a-9c4f-2f4a1b7d9e10";
const IRL_RULE_CODE = "irl_index";

type LeaseRecord = typeof tables.lease.$inferSelect;
type Context = { organizationId: string; session: { user: { id: string } } };

function actorOf(context: Context) {
  return { organizationId: context.organizationId, actorUserId: context.session.user.id };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

function page<T>(rows: T[], limit: number, key: (item: T) => [string, string]) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const hasMore = rows.length > limit;
  const cursorKey = hasMore && last ? key(last) : null;
  return { items, nextCursor: cursorKey ? encodeCursor(cursorKey[0], cursorKey[1]) : null };
}

function operationKey(command: string, objectId: string): string {
  return uuidv5(`${command}:${objectId}`, OPERATION_NAMESPACE);
}

/** MOD-03: the lock is (id, version) in the database, not the state of the screen. */
function assertUpdated<T>(rows: T[], details: Record<string, unknown>): T {
  const row = rows[0];
  if (!row) throw new AppError("VERSION_CONFLICT", { details });
  return row;
}

const PERSON_ROLE_BY_PARTY: Record<string, string> = {
  holder: "tenant",
  co_holder: "co_tenant",
  occupant: "occupant",
  guarantor: "guarantor",
  payer_third_party: "other",
  landlord: "other",
};

async function insertPerson(
  tx: Tx,
  organizationId: string,
  input: CreatePersonInput,
): Promise<string> {
  const rows = await tx
    .insert(tables.person)
    .values({
      organizationId,
      kind: input.kind,
      displayName: input.displayName,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      companyName: input.companyName ?? null,
      birthDate: input.birthDate ?? null,
    })
    .returning({ id: tables.person.id });
  const id = rows[0]?.id;
  if (!id) throw new AppError("CONFLICT", { message: "person insert returned no row" });

  for (const point of input.contactPoints ?? []) {
    await tx.insert(tables.contactPoint).values({
      organizationId,
      personId: id,
      kind: point.kind,
      value: point.value,
      label: point.label ?? null,
      isPrimary: point.isPrimary ?? false,
    });
  }
  return id;
}

function versionsOf(
  lease: LeaseRecord,
  rows: (typeof tables.leaseVersion.$inferSelect)[],
): RentVersion[] {
  const chargeKind = lease.chargeRegime === "flat_fee" ? "flat" : "provision";
  if (rows.length === 0) {
    return [
      {
        effectiveFrom: lease.startsOn ?? "1970-01-01",
        rentExclCharges: lease.rentExclCharges ?? "0",
        charges: { kind: chargeKind, amount: lease.chargeAmount ?? "0" },
      },
    ];
  }
  return rows.map((row) => ({
    effectiveFrom: row.effectiveOn,
    rentExclCharges: row.rentExclCharges ?? lease.rentExclCharges ?? "0",
    charges: { kind: chargeKind, amount: row.chargeAmount ?? lease.chargeAmount ?? "0" },
  }));
}

async function billingPersonId(tx: Tx, leaseId: string): Promise<string | null> {
  const rows = await tx
    .select({ personId: tables.leaseParty.personId, billing: tables.leaseParty.isBillingContact })
    .from(tables.leaseParty)
    .where(eq(tables.leaseParty.leaseId, leaseId));
  const billing = rows.find((row) => row.billing) ?? rows[0];
  return billing?.personId ?? null;
}

async function ensureDepositAccount(
  tx: Tx,
  organizationId: string,
  lease: LeaseRecord,
  fallbackAmount: string,
): Promise<string> {
  const existing = await tx
    .select({ id: tables.depositAccount.id })
    .from(tables.depositAccount)
    .where(eq(tables.depositAccount.leaseId, lease.id))
    .limit(1);
  const found = existing[0];
  if (found) return found.id;
  const created = await tx
    .insert(tables.depositAccount)
    .values({
      organizationId,
      leaseId: lease.id,
      contractualAmount: lease.depositAmount ?? fallbackAmount,
      currency: lease.currency,
      status: "expected",
    })
    .returning({ id: tables.depositAccount.id });
  const id = created[0]?.id;
  if (!id) throw new AppError("CONFLICT", { message: "deposit account insert returned no row" });
  return id;
}

type IndexObservation = { year: number; quarter: number; value: number };

async function irlObservations(tx: Tx): Promise<IndexObservation[]> {
  const rows = await tx
    .select({ definition: tables.ruleVersion.definition })
    .from(tables.ruleVersion)
    .innerJoin(tables.rule, eq(tables.ruleVersion.ruleId, tables.rule.id))
    .where(and(eq(tables.rule.code, IRL_RULE_CODE), eq(tables.ruleVersion.status, "active")))
    .limit(1);
  const definition = rows[0]?.definition as { observations?: IndexObservation[] } | undefined;
  return definition?.observations ?? [];
}

function parseQuarter(value: string | null): { year: number; quarter: 1 | 2 | 3 | 4 } | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(value ?? "");
  const year = match?.[1];
  const quarter = match?.[2];
  if (!year || !quarter) return null;
  return { year: Number(year), quarter: Number(quarter) as 1 | 2 | 3 | 4 };
}

/** IRL-01: every input is read from the lease and the stored index series; nothing is guessed. */
async function buildProposal(
  tx: Tx,
  lease: LeaseRecord,
  requestDate: string,
): Promise<RevisionProposal> {
  const reference = parseQuarter(lease.revisionReferenceQuarter);
  const observations = reference ? await irlObservations(tx) : [];
  const base = reference
    ? observations.find((o) => o.year === reference.year && o.quarter === reference.quarter)
    : undefined;
  const latest = reference
    ? observations
        .filter((o) => o.quarter === reference.quarter && o.year > reference.year)
        .sort((a, b) => b.year - a.year)[0]
    : undefined;

  const units = await tx
    .select({ energyClass: tables.unit.energyClass })
    .from(tables.leaseUnit)
    .innerJoin(tables.unit, eq(tables.leaseUnit.unitId, tables.unit.id))
    .where(and(eq(tables.leaseUnit.leaseId, lease.id), eq(tables.leaseUnit.role, "main")))
    .limit(1);
  const energyClass = units[0]?.energyClass ?? undefined;

  const month = lease.revisionMonth ?? Number((lease.startsOn ?? requestDate).slice(5, 7));
  const revisionDueDate = `${requestDate.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;

  return proposeRevision({
    currentRent: lease.rentExclCharges ?? "0",
    clausePresent: lease.revisionIndex !== null && lease.revisionIndex !== "none",
    ...(base && reference
      ? { baseIndex: { value: base.value.toFixed(2), quarter: reference.quarter, year: base.year } }
      : {}),
    ...(latest && reference
      ? {
          newIndex: {
            value: latest.value.toFixed(2),
            quarter: reference.quarter,
            year: latest.year,
          },
        }
      : {}),
    ...(energyClass ? { dpeClass: energyClass as "A" } : {}),
    territory: "metropole",
    requestDate,
    revisionDueDate,
  });
}

async function proposalView(
  tx: Tx,
  lease: LeaseRecord,
  proposal: RevisionProposal,
): Promise<RevisionProposalRead> {
  const revisions = await tx
    .select()
    .from(tables.rentRevision)
    .where(eq(tables.rentRevision.leaseId, lease.id))
    .orderBy(sql`created_at DESC`)
    .limit(1);
  const revision = revisions[0];
  let prepared: RevisionProposalRead["prepared"] = null;
  if (revision) {
    const commands = await tx
      .select({ id: tables.command.id, status: tables.command.status })
      .from(tables.command)
      .where(eq(tables.command.operationKey, operationKey("revise_rent", revision.id)))
      .limit(1);
    const command = commands[0];
    if (command) {
      prepared = {
        revisionId: revision.id,
        commandId: command.id,
        proposedRent: revision.proposedRent,
        status: command.status,
      };
    }
  }
  if (!proposal.ok) {
    return {
      available: false,
      blockedReason: proposal.reason,
      missing: proposal.missing ?? [],
      currentRent: lease.rentExclCharges,
      newRent: null,
      increase: null,
      baseIndex: null,
      newIndex: null,
      effectiveFrom: null,
      prepared,
    };
  }
  return {
    available: true,
    blockedReason: null,
    missing: [],
    currentRent: proposal.currentRent,
    newRent: proposal.newRent,
    increase: proposal.increase,
    baseIndex: proposal.baseIndex,
    newIndex: proposal.newIndex,
    effectiveFrom: proposal.effectiveFrom,
    prepared,
  };
}

export const locationsRouter = {
  locations: {
    units: {
      options: withOrganization.locations.units.options
        .use(validated(UnitOptions))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const conditions = [eq(tables.unit.status, "active")];
            if (input.search) conditions.push(ilike(tables.unit.label, `%${input.search}%`));
            const rows = await tx
              .select({
                id: tables.unit.id,
                label: tables.unit.label,
                buildingName: tables.building.name,
                occupied: sql<boolean>`EXISTS (
                  SELECT 1 FROM lease_unit lu JOIN lease l ON l.id = lu.lease_id
                  WHERE lu.unit_id = ${tables.unit.id} AND l.status = 'active'
                )`,
              })
              .from(tables.unit)
              .innerJoin(tables.building, eq(tables.unit.buildingId, tables.building.id))
              .where(and(...conditions))
              .orderBy(asc(tables.building.name), asc(tables.unit.label))
              .limit(200);
            return { items: rows };
          }),
        ),
    },
    persons: {
      list: withOrganization.locations.persons.list
        .use(validated(PersonPage))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const after = decodeCursor(input.cursor);
            const conditions = [];
            if (input.status) conditions.push(eq(tables.person.status, input.status));
            if (input.search) {
              conditions.push(ilike(tables.person.displayName, `%${input.search}%`));
            }
            if (after) {
              conditions.push(
                sql`(${tables.person.displayName}, ${tables.person.id}) > (${after.sortKey}, ${after.id}::uuid)`,
              );
            }
            const rows = await tx
              .select({
                id: tables.person.id,
                kind: tables.person.kind,
                displayName: tables.person.displayName,
                status: tables.person.status,
                version: tables.person.version,
                email: sql<
                  string | null
                >`(SELECT cp.value FROM contact_point cp WHERE cp.person_id = ${tables.person.id} AND cp.kind = 'email' ORDER BY cp.is_primary DESC LIMIT 1)`,
                phone: sql<
                  string | null
                >`(SELECT cp.value FROM contact_point cp WHERE cp.person_id = ${tables.person.id} AND cp.kind IN ('mobile','phone') ORDER BY cp.is_primary DESC LIMIT 1)`,
                leaseCount: sql<number>`(SELECT count(DISTINCT lp.lease_id) FROM lease_party lp WHERE lp.person_id = ${tables.person.id})::int`,
              })
              .from(tables.person)
              .where(conditions.length > 0 ? and(...conditions) : undefined)
              .orderBy(asc(tables.person.displayName), asc(tables.person.id))
              .limit(input.limit + 1);

            return page(
              rows.map((row) => ({
                ...row,
                kind: row.kind as PersonKind,
                status: row.status as "active",
              })),
              input.limit,
              (item) => [item.displayName, item.id],
            );
          }),
        ),

      get: withOrganization.locations.persons.get
        .use(validated(PersonDetail))
        .handler(async ({ context, input }) => tenant(context, (tx) => personDetail(tx, input.id))),

      create: withOrganization.locations.persons.create
        .use(validated(PersonDetail))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const id = await insertPerson(tx, context.organizationId, input);
            await audit(tx, actorOf(context), {
              objectTable: "person",
              objectId: id,
              action: "create",
              afterValue: { displayName: input.displayName, kind: input.kind },
            });
            return personDetail(tx, id);
          }),
        ),

      update: withOrganization.locations.persons.update
        .use(validated(PersonDetail))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const { id, expectedVersion, contactPoints, ...patch } = input;
            const before = await personDetail(tx, id);
            const rows = await tx
              .update(tables.person)
              .set({ ...patch, version: expectedVersion + 1, updatedAt: now() })
              .where(and(eq(tables.person.id, id), eq(tables.person.version, expectedVersion)))
              .returning({ id: tables.person.id });
            assertUpdated(rows, { personId: id, expectedVersion });

            if (contactPoints) {
              await tx
                .update(tables.contactPoint)
                .set({ status: "obsolete", updatedAt: now() })
                .where(eq(tables.contactPoint.personId, id));
              for (const point of contactPoints) {
                await tx.insert(tables.contactPoint).values({
                  organizationId: context.organizationId,
                  personId: id,
                  kind: point.kind,
                  value: point.value,
                  label: point.label ?? null,
                  isPrimary: point.isPrimary ?? false,
                });
              }
            }
            await audit(tx, actorOf(context), {
              objectTable: "person",
              objectId: id,
              action: "update",
              beforeValue: { displayName: before.displayName },
              afterValue: patch,
            });
            return personDetail(tx, id);
          }),
        ),
    },

    leases: {
      list: withOrganization.locations.leases.list
        .use(validated(LeasePage))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const after = decodeCursor(input.cursor);
            const conditions = [];
            if (input.status) conditions.push(eq(tables.lease.status, input.status));
            if (input.search) conditions.push(ilike(tables.lease.reference, `%${input.search}%`));
            if (input.unitId) {
              conditions.push(
                sql`EXISTS (SELECT 1 FROM lease_unit lu WHERE lu.lease_id = ${tables.lease.id} AND lu.unit_id = ${input.unitId}::uuid)`,
              );
            }
            if (input.buildingId) {
              conditions.push(
                sql`EXISTS (SELECT 1 FROM lease_unit lu JOIN unit u ON u.id = lu.unit_id WHERE lu.lease_id = ${tables.lease.id} AND u.building_id = ${input.buildingId}::uuid)`,
              );
            }
            if (input.personId) {
              conditions.push(
                sql`EXISTS (SELECT 1 FROM lease_party lp WHERE lp.lease_id = ${tables.lease.id} AND lp.person_id = ${input.personId}::uuid)`,
              );
            }
            if (after) {
              conditions.push(
                sql`(${tables.lease.createdAt}, ${tables.lease.id}) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`,
              );
            }
            const rows = await tx
              .select()
              .from(tables.lease)
              .where(conditions.length > 0 ? and(...conditions) : undefined)
              .orderBy(sql`created_at DESC`, sql`id DESC`)
              .limit(input.limit + 1);

            const items = await leaseListItems(tx, rows);
            const byId = new Map(rows.map((row) => [row.id, row.createdAt]));
            return page(items, input.limit, (item) => [byId.get(item.id) ?? "", item.id]);
          }),
        ),

      get: withOrganization.locations.leases.get
        .use(validated(LeaseDetail))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => leaseDetail(tx, await leaseRow(tx, input.id))),
        ),

      create: withOrganization.locations.leases.create
        .use(validated(LeaseDetail))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const unitIds = input.units.map((unit) => unit.unitId);
            const units = await tx
              .select({
                id: tables.unit.id,
                legalEntityId: tables.building.legalEntityId,
              })
              .from(tables.unit)
              .innerJoin(tables.building, eq(tables.unit.buildingId, tables.building.id))
              .where(inArray(tables.unit.id, unitIds));
            if (units.length !== unitIds.length) {
              throw new AppError("NOT_FOUND", { details: { unitIds } });
            }
            const legalEntityId = units[0]?.legalEntityId;
            if (!legalEntityId) throw new AppError("NOT_FOUND", { details: { unitIds } });

            const leaseRows = await tx
              .insert(tables.lease)
              .values({
                organizationId,
                legalEntityId,
                reference: input.reference,
                kind: input.kind,
                status: "draft",
                startsOn: input.startsOn,
                endsOn: input.endsOn ?? null,
                rentExclCharges: input.rentExclCharges,
                chargeRegime: input.chargeRegime,
                chargeAmount: input.chargeAmount ?? null,
                depositAmount: input.depositAmount ?? null,
                paymentDay: input.paymentDay,
                revisionIndex: input.revisionIndex ?? null,
                revisionReferenceQuarter: input.revisionReferenceQuarter ?? null,
                revisionMonth: input.revisionMonth ?? null,
                solidarity: input.solidarity ?? false,
              })
              .returning();
            const lease = leaseRows[0];
            if (!lease) throw new AppError("CONFLICT", { message: "lease insert returned no row" });

            for (const party of input.parties) {
              const personId =
                party.personId ??
                (party.person ? await insertPerson(tx, organizationId, party.person) : undefined);
              if (!personId) throw new AppError("VALIDATION", { details: { party } });
              await tx.insert(tables.leaseParty).values({
                organizationId,
                leaseId: lease.id,
                personId,
                role: party.role,
                startsOn: party.startsOn,
                isBillingContact: party.isBillingContact ?? false,
              });
              await tx
                .insert(tables.personRole)
                .values({
                  organizationId,
                  personId,
                  role: PERSON_ROLE_BY_PARTY[party.role] ?? "other",
                  legalEntityId,
                  startsOn: party.startsOn,
                })
                .onConflictDoNothing();
            }

            for (const unit of input.units) {
              await tx.insert(tables.leaseUnit).values({
                organizationId,
                leaseId: lease.id,
                unitId: unit.unitId,
                role: unit.role,
                startsOn: input.startsOn,
              });
            }

            // BAI-03: the initial signed content is a version of its own.
            await tx.insert(tables.leaseVersion).values({
              organizationId,
              leaseId: lease.id,
              sequence: 1,
              kind: "initial",
              effectiveOn: input.startsOn,
              rentExclCharges: input.rentExclCharges,
              chargeAmount: input.chargeAmount ?? null,
              summary: "Bail initial",
            });

            if (input.depositAmount) {
              await ensureDepositAccount(tx, organizationId, lease, input.depositAmount);
            }

            await audit(tx, actorOf(context), {
              objectTable: "lease",
              objectId: lease.id,
              action: "create",
              afterValue: { reference: lease.reference, kind: lease.kind },
            });
            return leaseDetail(tx, lease);
          }),
        ),

      update: withOrganization.locations.leases.update
        .use(validated(LeaseDetail))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const { id, expectedVersion, ...patch } = input;
            const before = await leaseRow(tx, id);
            const rows = await tx
              .update(tables.lease)
              .set({ ...patch, version: expectedVersion + 1, updatedAt: now() })
              .where(and(eq(tables.lease.id, id), eq(tables.lease.version, expectedVersion)))
              .returning();
            const updated = assertUpdated(rows, { leaseId: id, expectedVersion });
            await audit(tx, actorOf(context), {
              objectTable: "lease",
              objectId: id,
              action: "update",
              beforeValue: { rentExclCharges: before.rentExclCharges, status: before.status },
              afterValue: patch,
            });
            return leaseDetail(tx, updated);
          }),
        ),

      transition: withOrganization.locations.leases.transition
        .use(validated(LeaseDetail))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const lease = await leaseRow(tx, input.id);
            const from = lease.status as LeaseStatus;
            if (!allowedTransitions(from).includes(input.to)) {
              throw new AppError("RULE_VIOLATION", {
                message: `Passage de « ${from} » à « ${input.to} » impossible.`,
                details: { from, to: input.to, allowed: allowedTransitions(from) },
              });
            }

            const detail = await leaseDetail(tx, lease);
            // BAI-01: the engine checks the missing pieces before activation.
            if (input.to === "active" && detail.missingPieces.length > 0) {
              throw new AppError("RULE_VIOLATION", {
                message: "Le bail ne peut pas être activé : des éléments manquent.",
                details: { missing: detail.missingPieces },
              });
            }

            const patch: Record<string, unknown> = {
              status: input.to,
              version: input.expectedVersion + 1,
              updatedAt: now(),
            };
            if (input.to === "signed" && !lease.signedOn) patch.signedOn = today();
            if (input.to === "terminated" && !lease.endsOn) patch.endsOn = today();

            const rows = await tx
              .update(tables.lease)
              .set(patch)
              .where(
                and(
                  eq(tables.lease.id, input.id),
                  eq(tables.lease.version, input.expectedVersion),
                  eq(tables.lease.status, from),
                ),
              )
              .returning();
            const updated = assertUpdated(rows, {
              leaseId: input.id,
              expectedVersion: input.expectedVersion,
            });

            if (input.to === "active") {
              await ensureDepositAccount(
                tx,
                organizationId,
                updated,
                updated.depositAmount ?? "0.00",
              );
              // PAT-01: the occupation period is recorded unless one already covers the dates.
              for (const unit of detail.units.filter((one) => one.role === "main")) {
                const overlapping = await tx
                  .select({ id: tables.unitUsagePeriod.id })
                  .from(tables.unitUsagePeriod)
                  .where(
                    and(
                      eq(tables.unitUsagePeriod.unitId, unit.unitId),
                      sql`daterange(starts_on, ends_on, '[)') && daterange(${updated.startsOn ?? today()}::date, ${updated.endsOn}::date, '[)')`,
                    ),
                  )
                  .limit(1);
                if (overlapping.length > 0) continue;
                await tx.insert(tables.unitUsagePeriod).values({
                  organizationId,
                  unitId: unit.unitId,
                  usage: usageForLeaseKind(updated.kind),
                  startsOn: updated.startsOn ?? today(),
                  endsOn: updated.endsOn,
                });
              }
            }

            const eventType =
              input.to === "signed"
                ? "lease.signed"
                : input.to === "active"
                  ? "lease.activated"
                  : input.to === "terminated"
                    ? "lease.ended"
                    : null;
            if (eventType) {
              await emitEvent(tx, actorOf(context), {
                type: eventType,
                kind: "lease",
                id: updated.id,
                payload: { from, to: input.to },
                ...(updated.startsOn ? { effectiveOn: updated.startsOn } : {}),
              });
            }

            await audit(tx, actorOf(context), {
              objectTable: "lease",
              objectId: updated.id,
              action: `transition.${input.to}`,
              beforeValue: { status: from },
              afterValue: { status: input.to },
            });
            return leaseDetail(tx, updated);
          }),
        ),
    },

    rentTerms: {
      list: withOrganization.locations.rentTerms.list
        .use(validated(RentTermPage))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            await leaseRow(tx, input.leaseId);
            const all = await termsForLeases(tx, [input.leaseId]);
            const filtered = input.status
              ? all.filter((term) => term.status === input.status)
              : all;
            const after = decodeCursor(input.cursor);
            const rows = after
              ? filtered.filter((term) => term.periodStart > after.sortKey)
              : filtered;
            return page(rows.slice(0, input.limit + 1), input.limit, (item) => [
              item.periodStart,
              item.id,
            ]);
          }),
        ),

      /** LOY-01: one engine, identity (lease, kind, period); a re-run creates nothing twice. */
      generate: withOrganization.locations.rentTerms.generate
        .use(validated(GenerateTermsResult))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const lease = await leaseRow(tx, input.leaseId);
            if (!lease.startsOn) {
              throw new AppError("RULE_VIOLATION", {
                message: "Le bail n’a pas de date de début.",
                details: { leaseId: lease.id },
              });
            }
            const leaseVersions = await tx
              .select()
              .from(tables.leaseVersion)
              .where(eq(tables.leaseVersion.leaseId, lease.id))
              .orderBy(asc(tables.leaseVersion.sequence));

            const terms: LeaseTerms = {
              leaseId: lease.id,
              start: lease.startsOn,
              ...(lease.endsOn ? { end: lease.endsOn } : {}),
              dueDay: lease.paymentDay ?? 1,
              versions: versionsOf(lease, leaseVersions),
            };
            const generated = generateRentTerms(terms, { start: input.from, end: input.to });

            let created = 0;
            let skipped = 0;
            for (const term of generated) {
              const inserted = await tx
                .insert(tables.rentTerm)
                .values({
                  organizationId,
                  leaseId: lease.id,
                  kind: "rent",
                  periodStart: term.periodStart,
                  periodEnd: term.periodEnd,
                  dueOn: term.dueDate,
                  status: "planned",
                })
                .onConflictDoNothing()
                .returning({ id: tables.rentTerm.id });
              const row = inserted[0];
              if (!row) {
                skipped += 1;
                continue;
              }
              created += 1;
              const versionRows = await tx
                .insert(tables.rentTermVersion)
                .values({
                  organizationId,
                  rentTermId: row.id,
                  sequence: 1,
                  rentAmount: term.rent,
                  chargeAmount: term.charges,
                  accessoryAmount: "0",
                  totalAmount: term.total,
                  currency: lease.currency,
                  reason: term.prorated ? "proration" : "initial",
                })
                .returning({ id: tables.rentTermVersion.id });
              const versionRow = versionRows[0];
              if (versionRow) {
                await tx
                  .update(tables.rentTerm)
                  .set({ currentVersionId: versionRow.id, status: "authorized" })
                  .where(eq(tables.rentTerm.id, row.id));
              }
              await audit(tx, actorOf(context), {
                objectTable: "rent_term",
                objectId: row.id,
                action: "generate",
                afterValue: { periodStart: term.periodStart, total: term.total },
              });
            }

            return { created, skipped, terms: await termsForLeases(tx, [lease.id]) };
          }),
        ),
    },

    payments: {
      list: withOrganization.locations.payments.list
        .use(validated(PaymentPage))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const rows = await paymentsForLease(
              tx,
              input.leaseId ? { leaseId: input.leaseId } : {},
            );
            const after = decodeCursor(input.cursor);
            const filtered = after ? rows.filter((row) => row.id !== after.id) : rows;
            return page(filtered.slice(0, input.limit + 1), input.limit, (item) => [
              item.receivedOn,
              item.id,
            ]);
          }),
        ),

      create: withOrganization.locations.payments.create
        .use(validated(PaymentRead))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const lease = await leaseRow(tx, input.leaseId);
            // LOY-02: a receipt is tied to the lease by its payer until it is allocated.
            const payerPersonId = input.payerPersonId ?? (await billingPersonId(tx, lease.id));
            const rows = await tx
              .insert(tables.payment)
              .values({
                organizationId,
                legalEntityId: lease.legalEntityId,
                direction: "inbound",
                amount: input.amount,
                currency: lease.currency,
                receivedOn: input.receivedOn,
                method: input.method ?? null,
                payerPersonId,
                payerLabel: input.payerLabel ?? null,
                // LOY-02: a receipt with no allocation stays to be qualified.
                status: "to_qualify",
              })
              .returning();
            const payment = rows[0];
            if (!payment) {
              throw new AppError("CONFLICT", { message: "payment insert returned no row" });
            }
            await emitEvent(tx, actorOf(context), {
              type: "payment.recorded",
              kind: "payment",
              id: payment.id,
              effectiveOn: payment.receivedOn,
              payload: { amount: payment.amount, leaseId: lease.id },
              also: [{ kind: "lease", id: lease.id }],
            });
            await audit(tx, actorOf(context), {
              objectTable: "payment",
              objectId: payment.id,
              action: "create",
              afterValue: { amount: payment.amount, receivedOn: payment.receivedOn },
            });
            const read = await paymentsForLease(tx, { paymentId: payment.id });
            const view = read[0];
            if (!view) throw new AppError("NOT_FOUND", { details: { paymentId: payment.id } });
            return view;
          }),
        ),

      /** LOY-02: the allocation is explicit and checked against what each term still owes. */
      allocate: withOrganization.locations.payments.allocate
        .use(validated(AllocateResult))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const paymentRows = await tx
              .select()
              .from(tables.payment)
              .where(eq(tables.payment.id, input.paymentId))
              .limit(1);
            const payment = paymentRows[0];
            if (!payment) {
              throw new AppError("NOT_FOUND", { details: { paymentId: input.paymentId } });
            }

            const termRows = await tx
              .select({ id: tables.rentTerm.id, leaseId: tables.rentTerm.leaseId })
              .from(tables.rentTerm)
              .where(
                inArray(
                  tables.rentTerm.id,
                  input.allocations.map((one) => one.rentTermId),
                ),
              );
            if (termRows.length !== new Set(input.allocations.map((a) => a.rentTermId)).size) {
              throw new AppError("NOT_FOUND", { details: { allocations: input.allocations } });
            }
            const leaseIds = [...new Set(termRows.map((row) => row.leaseId))];
            const leaseId = leaseIds[0];
            if (leaseIds.length !== 1 || !leaseId) {
              throw new AppError("VALIDATION", {
                message: "Une affectation porte sur un seul bail à la fois.",
                details: { leaseIds },
              });
            }

            const before = await termsForLeases(tx, [leaseId]);
            const current = (await paymentsForLease(tx, { paymentId: payment.id }))[0];
            if (!current) throw new AppError("NOT_FOUND", { details: { paymentId: payment.id } });

            const result = allocatePayment({
              payment: { paymentId: payment.id, amount: current.unallocatedAmount },
              terms: before.map((term) => {
                const paid = splitOnRentFirst(term.paidAmount, term.rentAmount, term.chargeAmount);
                return {
                  termId: term.id,
                  rent: term.rentAmount,
                  charges: term.chargeAmount,
                  paidRent: paid.rent,
                  paidCharges: paid.charges,
                };
              }),
              allocations: input.allocations.map((allocation) => {
                const term = before.find((one) => one.id === allocation.rentTermId);
                const outstandingRent = term
                  ? outstandingOf(
                      term.rentAmount,
                      splitOnRentFirst(term.paidAmount, term.rentAmount, term.chargeAmount).rent,
                    )
                  : "0.00";
                const outstandingCharges = term
                  ? outstandingOf(
                      term.chargeAmount,
                      splitOnRentFirst(term.paidAmount, term.rentAmount, term.chargeAmount).charges,
                    )
                  : "0.00";
                const split = splitOnRentFirst(
                  allocation.amount,
                  outstandingRent,
                  outstandingCharges,
                );
                return { termId: allocation.rentTermId, rent: split.rent, charges: split.charges };
              }),
            });

            if (!result.ok) {
              throw new AppError("RULE_VIOLATION", {
                message: "Affectation refusée : le montant dépasse ce qui reste dû.",
                details: { reason: result.reason, terms: result.missing ?? [] },
              });
            }

            const allocatedOn = input.allocatedOn ?? today();
            for (const allocation of input.allocations) {
              await tx.insert(tables.paymentAllocation).values({
                organizationId,
                paymentId: payment.id,
                rentTermId: allocation.rentTermId,
                amount: allocation.amount,
                currency: payment.currency,
                allocatedOn,
              });
            }

            for (const term of result.terms) {
              const touched = input.allocations.some((one) => one.rentTermId === term.termId);
              if (!touched) continue;
              await tx
                .update(tables.rentTerm)
                .set({
                  status: term.status === "paid" ? "settled" : "partially_settled",
                  settledAt: term.status === "paid" ? now() : null,
                  updatedAt: now(),
                })
                .where(eq(tables.rentTerm.id, term.termId));
            }

            const paymentStatus =
              result.status === "fully_allocated"
                ? "allocated"
                : result.status === "overpaid"
                  ? "overpaid"
                  : "partially_allocated";
            const updatedRows = await tx
              .update(tables.payment)
              .set({
                status: paymentStatus,
                version: input.expectedVersion + 1,
                updatedAt: now(),
              })
              .where(
                and(
                  eq(tables.payment.id, payment.id),
                  eq(tables.payment.version, input.expectedVersion),
                ),
              )
              .returning({ id: tables.payment.id });
            assertUpdated(updatedRows, {
              paymentId: payment.id,
              expectedVersion: input.expectedVersion,
            });

            await audit(tx, actorOf(context), {
              objectTable: "payment_allocation",
              objectId: payment.id,
              action: "allocate",
              afterValue: { allocations: input.allocations, status: paymentStatus },
            });

            const read = (await paymentsForLease(tx, { paymentId: payment.id }))[0];
            if (!read) throw new AppError("NOT_FOUND", { details: { paymentId: payment.id } });
            return {
              payment: read,
              terms: await termsForLeases(tx, [leaseId]),
              overpayment: result.overpayment,
            };
          }),
        ),
    },

    receipts: {
      list: withOrganization.locations.receipts.list
        .use(validated(ReceiptPage))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const rows = await receiptsForLease(tx, input.leaseId);
            return page(rows.slice(0, input.limit + 1), input.limit, (item) => [
              item.issuedOn,
              item.id,
            ]);
          }),
        ),

      /** LOY-03: a quittance only once rent and charges are settled; otherwise a reçu. */
      issue: withOrganization.locations.receipts.issue
        .use(validated(ReceiptRead))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const termRows = await tx
              .select({ leaseId: tables.rentTerm.leaseId })
              .from(tables.rentTerm)
              .where(eq(tables.rentTerm.id, input.rentTermId))
              .limit(1);
            const leaseId = termRows[0]?.leaseId;
            if (!leaseId) {
              throw new AppError("NOT_FOUND", { details: { rentTermId: input.rentTermId } });
            }
            const lease = await leaseRow(tx, leaseId);
            const term = (await termsForLeases(tx, [leaseId])).find(
              (one) => one.id === input.rentTermId,
            );
            if (!term) {
              throw new AppError("NOT_FOUND", { details: { rentTermId: input.rentTermId } });
            }

            const computed = receiptKindOf(term);
            if (input.kind === "quittance" && computed !== "quittance") {
              throw new AppError("RULE_VIOLATION", {
                message:
                  "Quittance impossible : le loyer et les charges de la période ne sont pas intégralement réglés.",
                details: { outstanding: term.outstanding },
              });
            }
            const kind = computed === "quittance" ? "quittance" : "recu_partiel";
            const paid = splitOnRentFirst(term.paidAmount, term.rentAmount, term.chargeAmount);
            const issuedOn = today();

            const receiptRows = await tx
              .insert(tables.rentReceipt)
              .values({
                organizationId,
                leaseId,
                kind,
                periodStart: term.periodStart,
                periodEnd: term.periodEnd,
                rentAmount: paid.rent,
                chargeAmount: paid.charges,
                totalAmount: term.paidAmount,
                currency: term.currency,
                issuedOn,
                status: "issued",
              })
              .returning();
            const receipt = receiptRows[0];
            if (!receipt) {
              throw new AppError("CONFLICT", { message: "receipt insert returned no row" });
            }

            const payload = {
              leaseId,
              kind,
              periodStart: term.periodStart,
              periodEnd: term.periodEnd,
              rentAmount: paid.rent,
              chargeAmount: paid.charges,
              totalAmount: term.paidAmount,
              currency: term.currency,
              issuedOn,
            };
            const envelope = CommandEnvelope.parse({
              operationId: operationKey("issue_receipt", receipt.id),
              command: "issue_receipt",
              objectId: leaseId,
              expectedVersion: lease.version,
              ruleVersion: null,
              payload,
              payloadHash: hashPayload(payload),
              requestId: context.requestId,
            });
            const command = await createCommand(tx, {
              organizationId,
              commandType: envelope.command,
              operationKey: envelope.operationId,
              payload: envelope.payload,
              payloadHash: envelope.payloadHash,
              expectedVersion: envelope.expectedVersion,
              actorUserId: context.session.user.id,
              autonomyLevel: decisionLevelByCommand.issue_receipt,
              status: "prepared",
            });

            await emitEvent(tx, actorOf(context), {
              type: "receipt.issued",
              kind: "lease",
              id: leaseId,
              effectiveOn: issuedOn,
              payload: { receiptId: receipt.id, kind, commandId: command.id },
            });
            await audit(tx, actorOf(context), {
              objectTable: "rent_receipt",
              objectId: receipt.id,
              action: "issue",
              afterValue: payload,
            });

            await enqueueJob("pdf.render", {
              organizationId,
              rentReceiptId: receipt.id,
              template: kind === "quittance" ? "quittance" : "recu",
            });

            const view = (await receiptsForLease(tx, leaseId)).find((one) => one.id === receipt.id);
            if (!view) throw new AppError("NOT_FOUND", { details: { receiptId: receipt.id } });
            return { ...view, commandId: command.id };
          }),
        ),
    },

    deposits: {
      get: withOrganization.locations.deposits.get
        .use(validated(DepositRead))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            await leaseRow(tx, input.leaseId);
            return depositFor(tx, input.leaseId);
          }),
        ),

      record: withOrganization.locations.deposits.record
        .use(validated(DepositRead))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const lease = await leaseRow(tx, input.leaseId);
            const accountId = await ensureDepositAccount(tx, organizationId, lease, input.amount);
            await tx.insert(tables.depositMovement).values({
              organizationId,
              depositAccountId: accountId,
              kind: input.kind,
              amount: input.amount,
              currency: lease.currency,
              occurredOn: input.occurredOn,
            });
            const balance = await depositFor(tx, input.leaseId);
            await tx
              .update(tables.depositAccount)
              .set({
                status: sumMoney([balance.balanceAmount]) === "0.00" ? "closed" : "open",
                updatedAt: now(),
              })
              .where(eq(tables.depositAccount.id, accountId));
            await audit(tx, actorOf(context), {
              objectTable: "deposit_movement",
              objectId: accountId,
              action: `movement.${input.kind}`,
              afterValue: { amount: input.amount, occurredOn: input.occurredOn },
            });
            return depositFor(tx, input.leaseId);
          }),
        ),
    },

    revisions: {
      propose: withOrganization.locations.revisions.propose
        .use(validated(RevisionProposalRead))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const lease = await leaseRow(tx, input.leaseId);
            const proposal = await buildProposal(tx, lease, input.requestDate ?? today());
            return proposalView(tx, lease, proposal);
          }),
        ),

      /** Decision level D (§17.1): the command stays `prepared` until a human approves it. */
      apply: withOrganization.locations.revisions.apply
        .use(validated(RevisionProposalRead))
        .handler(async ({ context, input }) =>
          tenant(context, async (tx) => {
            const organizationId = context.organizationId;
            const lease = await leaseRow(tx, input.leaseId);
            if (lease.version !== input.expectedVersion) {
              throw new AppError("VERSION_CONFLICT", {
                details: { leaseId: lease.id, expectedVersion: input.expectedVersion },
              });
            }
            const requestDate = today();
            const proposal = await buildProposal(tx, lease, requestDate);
            if (!proposal.ok) {
              throw new AppError("RULE_VIOLATION", {
                message: "La révision est bloquée ; complétez les éléments manquants.",
                details: { reason: proposal.reason, missing: proposal.missing ?? [] },
              });
            }

            const revisionRows = await tx
              .insert(tables.rentRevision)
              .values({
                organizationId,
                leaseId: lease.id,
                indexName: (lease.revisionIndex ?? "irl") as "irl",
                referenceQuarter: lease.revisionReferenceQuarter ?? "",
                previousIndexValue: proposal.baseIndex.value,
                newIndexValue: proposal.newIndex.value,
                baseRent: proposal.currentRent,
                computedRentUnrounded: proposal.newRentUnrounded,
                proposedRent: proposal.newRent,
                currency: lease.currency,
                requestedOn: requestDate,
                effectiveOn: proposal.effectiveFrom,
                status: "proposed",
              })
              .returning();
            const revision = revisionRows[0];
            if (!revision) {
              throw new AppError("CONFLICT", { message: "revision insert returned no row" });
            }

            const payload = {
              leaseId: lease.id,
              rentRevisionId: revision.id,
              indexName: revision.indexName as "irl",
              referenceQuarter: revision.referenceQuarter,
              previousIndexValue: revision.previousIndexValue,
              newIndexValue: revision.newIndexValue,
              baseRent: proposal.currentRent,
              proposedRent: proposal.newRent,
              currency: lease.currency,
              effectiveOn: proposal.effectiveFrom,
            };
            const envelope = CommandEnvelope.parse({
              operationId: operationKey("revise_rent", revision.id),
              command: "revise_rent",
              objectId: lease.id,
              expectedVersion: lease.version,
              ruleVersion: null,
              payload,
              payloadHash: hashPayload(payload),
              requestId: context.requestId,
            });
            await createCommand(tx, {
              organizationId,
              commandType: envelope.command,
              operationKey: envelope.operationId,
              payload: envelope.payload,
              payloadHash: envelope.payloadHash,
              expectedVersion: envelope.expectedVersion,
              actorUserId: context.session.user.id,
              autonomyLevel: decisionLevelByCommand.revise_rent,
              status: "prepared",
            });

            await emitEvent(tx, actorOf(context), {
              type: "revision.proposed",
              kind: "lease",
              id: lease.id,
              effectiveOn: proposal.effectiveFrom,
              payload: { revisionId: revision.id, proposedRent: proposal.newRent },
            });
            await audit(tx, actorOf(context), {
              objectTable: "rent_revision",
              objectId: revision.id,
              action: "propose",
              afterValue: payload,
            });

            return proposalView(tx, lease, proposal);
          }),
        ),
    },
  },
};
