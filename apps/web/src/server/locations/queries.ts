import "server-only";
import type {
  DepositAccountStatus,
  DepositMovementKind,
  LeaseChargeRegime,
  LeaseKind,
  LeasePartyRole,
  LeaseRevisionIndex,
  LeaseStatus,
  LeaseUnitRole,
  PaymentMethod,
  PaymentStatus,
  PersonKind,
  PersonStatus,
  RentReceiptKind,
  RentReceiptStatus,
  RentTermKind,
  RentTermStatus,
} from "@lfsci/contracts";
import { type Tx, tables } from "@lfsci/db";
import { AppError } from "@lfsci/kernel";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  ContactPointRead,
  DepositRead,
  LeaseDetail,
  LeaseListItem,
  LeasePartyRead,
  LeaseUnitRead,
  PaymentRead,
  PersonDetail,
  ReceiptRead,
  RentTermRead,
} from "@/lib/contracts/locations";
import {
  allowedTransitions,
  instant,
  type LeaseRow,
  missingPieces,
  nextDueOn,
  outstandingOf,
  receiptKindOf,
  settlementOf,
  sumMoney,
} from "./mappers";

const ZERO = "0.00";

export async function leaseRow(tx: Tx, id: string): Promise<LeaseRow> {
  const rows = await tx.select().from(tables.lease).where(eq(tables.lease.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { leaseId: id } });
  return row;
}

export async function termsForLeases(tx: Tx, leaseIds: string[]): Promise<RentTermRead[]> {
  if (leaseIds.length === 0) return [];
  const rows = await tx
    .select({
      id: tables.rentTerm.id,
      leaseId: tables.rentTerm.leaseId,
      kind: tables.rentTerm.kind,
      periodStart: tables.rentTerm.periodStart,
      periodEnd: tables.rentTerm.periodEnd,
      dueOn: tables.rentTerm.dueOn,
      status: tables.rentTerm.status,
      version: tables.rentTerm.version,
      rentAmount: tables.rentTermVersion.rentAmount,
      chargeAmount: tables.rentTermVersion.chargeAmount,
      totalAmount: tables.rentTermVersion.totalAmount,
      currency: tables.rentTermVersion.currency,
      paid: sql<string>`coalesce((
        SELECT sum(pa.amount) FROM payment_allocation pa
        WHERE pa.rent_term_id = ${tables.rentTerm.id} AND pa.reversed_at IS NULL
      ), 0)::text`,
      receiptIssued: sql<boolean>`exists (
        SELECT 1 FROM rent_receipt rr
        WHERE rr.lease_id = ${tables.rentTerm.leaseId}
          AND rr.period_start = ${tables.rentTerm.periodStart}
          AND rr.status <> 'superseded'
      )`,
    })
    .from(tables.rentTerm)
    .leftJoin(
      tables.rentTermVersion,
      eq(tables.rentTerm.currentVersionId, tables.rentTermVersion.id),
    )
    .where(inArray(tables.rentTerm.leaseId, leaseIds))
    .orderBy(asc(tables.rentTerm.periodStart));

  return rows.map((row) => {
    const rentAmount = row.rentAmount ?? ZERO;
    const chargeAmount = row.chargeAmount ?? ZERO;
    const totalAmount = row.totalAmount ?? ZERO;
    const paidAmount = sumMoney([row.paid]);
    return {
      id: row.id,
      leaseId: row.leaseId,
      kind: row.kind as RentTermKind,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      dueOn: row.dueOn,
      status: row.status as RentTermStatus,
      rentAmount,
      chargeAmount,
      totalAmount,
      currency: row.currency ?? "EUR",
      paidAmount,
      outstanding: outstandingOf(totalAmount, paidAmount),
      settlement: settlementOf(paidAmount, totalAmount),
      receipt: receiptKindOf({ rentAmount, chargeAmount, paidAmount }),
      receiptIssued: row.receiptIssued,
      version: row.version,
    };
  });
}

async function partiesForLeases(tx: Tx, leaseIds: string[]): Promise<LeasePartyRead[]> {
  if (leaseIds.length === 0) return [];
  const rows = await tx
    .select({
      id: tables.leaseParty.id,
      leaseId: tables.leaseParty.leaseId,
      personId: tables.leaseParty.personId,
      personName: tables.person.displayName,
      role: tables.leaseParty.role,
      startsOn: tables.leaseParty.startsOn,
      endsOn: tables.leaseParty.endsOn,
      isBillingContact: tables.leaseParty.isBillingContact,
    })
    .from(tables.leaseParty)
    .innerJoin(tables.person, eq(tables.leaseParty.personId, tables.person.id))
    .where(inArray(tables.leaseParty.leaseId, leaseIds))
    .orderBy(asc(tables.leaseParty.startsOn));
  return rows.map((row) => ({ ...row, role: row.role as LeasePartyRole }));
}

async function unitsForLeases(tx: Tx, leaseIds: string[]): Promise<LeaseUnitRead[]> {
  if (leaseIds.length === 0) return [];
  const rows = await tx
    .select({
      id: tables.leaseUnit.id,
      leaseId: tables.leaseUnit.leaseId,
      unitId: tables.leaseUnit.unitId,
      unitLabel: tables.unit.label,
      buildingName: tables.building.name,
      role: tables.leaseUnit.role,
      startsOn: tables.leaseUnit.startsOn,
      endsOn: tables.leaseUnit.endsOn,
    })
    .from(tables.leaseUnit)
    .innerJoin(tables.unit, eq(tables.leaseUnit.unitId, tables.unit.id))
    .innerJoin(tables.building, eq(tables.unit.buildingId, tables.building.id))
    .where(inArray(tables.leaseUnit.leaseId, leaseIds))
    .orderBy(asc(tables.leaseUnit.role));
  return rows.map((row) => ({ ...row, role: row.role as LeaseUnitRole }));
}

type WithLease<T> = T & { leaseId: string };

function listItem(
  lease: LeaseRow,
  parties: WithLease<LeasePartyRead>[],
  units: WithLease<LeaseUnitRead>[],
  terms: RentTermRead[],
): LeaseListItem {
  const mine = terms.filter((term) => term.leaseId === lease.id);
  const main = units.find((unit) => unit.leaseId === lease.id && unit.role === "main");
  return {
    id: lease.id,
    reference: lease.reference,
    kind: lease.kind as LeaseKind,
    status: lease.status as LeaseStatus,
    startsOn: lease.startsOn,
    endsOn: lease.endsOn,
    rentExclCharges: lease.rentExclCharges,
    chargeAmount: lease.chargeAmount,
    currency: lease.currency,
    unitLabel: main?.unitLabel ?? null,
    buildingName: main?.buildingName ?? null,
    tenants: parties
      .filter(
        (party) =>
          party.leaseId === lease.id && (party.role === "holder" || party.role === "co_holder"),
      )
      .map((party) => party.personName),
    nextDueOn: nextDueOn(mine),
    arrears: sumMoney(mine.map((term) => term.outstanding)),
    version: lease.version,
  };
}

export async function leaseListItems(tx: Tx, leases: LeaseRow[]): Promise<LeaseListItem[]> {
  const ids = leases.map((lease) => lease.id);
  const [parties, units, terms] = await Promise.all([
    partiesForLeases(tx, ids),
    unitsForLeases(tx, ids),
    termsForLeases(tx, ids),
  ]);
  return leases.map((lease) =>
    listItem(
      lease,
      parties as WithLease<LeasePartyRead>[],
      units as WithLease<LeaseUnitRead>[],
      terms,
    ),
  );
}

export async function leaseDetail(tx: Tx, lease: LeaseRow): Promise<LeaseDetail> {
  const [parties, units, terms, deposit] = await Promise.all([
    partiesForLeases(tx, [lease.id]),
    unitsForLeases(tx, [lease.id]),
    termsForLeases(tx, [lease.id]),
    depositFor(tx, lease.id),
  ]);
  const summary = listItem(
    lease,
    parties as WithLease<LeasePartyRead>[],
    units as WithLease<LeaseUnitRead>[],
    terms,
  );
  return {
    ...summary,
    legalEntityId: lease.legalEntityId,
    signedOn: lease.signedOn,
    durationMonths: lease.durationMonths,
    chargeRegime: lease.chargeRegime as LeaseChargeRegime,
    depositAmount: lease.depositAmount,
    depositBalance: deposit.accountId ? deposit.balanceAmount : null,
    paymentDay: lease.paymentDay,
    paymentInAdvance: lease.paymentInAdvance,
    revisionIndex: lease.revisionIndex as LeaseRevisionIndex | null,
    revisionReferenceQuarter: lease.revisionReferenceQuarter,
    revisionMonth: lease.revisionMonth,
    solidarity: lease.solidarity,
    noticeReceivedOn: lease.noticeReceivedOn,
    noticeAnnouncedEndOn: lease.noticeAnnouncedEndOn,
    noticeLegallyEstablished: lease.noticeLegallyEstablished,
    keysReturnedOn: lease.keysReturnedOn,
    parties,
    units,
    missingPieces: missingPieces({ lease, parties, units }),
    allowedTransitions: allowedTransitions(lease.status as LeaseStatus),
    createdAt: instant(lease.createdAt),
  };
}

export async function paymentsForLease(
  tx: Tx,
  filter: { leaseId?: string; paymentId?: string },
): Promise<PaymentRead[]> {
  const conditions = [eq(tables.payment.direction, "inbound")];
  if (filter.paymentId) conditions.push(eq(tables.payment.id, filter.paymentId));
  if (filter.leaseId) {
    conditions.push(
      // A payment reaches a lease either by an allocation or by its payer.
      sql`(
        EXISTS (
          SELECT 1 FROM payment_allocation pa
          JOIN rent_term rt ON rt.id = pa.rent_term_id
          WHERE pa.payment_id = ${tables.payment.id} AND rt.lease_id = ${filter.leaseId}::uuid
        )
        OR ${tables.payment.payerPersonId} IN (
          SELECT lp.person_id FROM lease_party lp WHERE lp.lease_id = ${filter.leaseId}::uuid
        )
      )`,
    );
  }
  const rows = await tx
    .select()
    .from(tables.payment)
    .where(and(...conditions))
    .orderBy(desc(tables.payment.receivedOn), desc(tables.payment.id));
  if (rows.length === 0) return [];

  const allocations = await tx
    .select({
      id: tables.paymentAllocation.id,
      paymentId: tables.paymentAllocation.paymentId,
      rentTermId: tables.paymentAllocation.rentTermId,
      amount: tables.paymentAllocation.amount,
      allocatedOn: tables.paymentAllocation.allocatedOn,
      periodStart: tables.rentTerm.periodStart,
    })
    .from(tables.paymentAllocation)
    .leftJoin(tables.rentTerm, eq(tables.paymentAllocation.rentTermId, tables.rentTerm.id))
    .where(
      and(
        inArray(
          tables.paymentAllocation.paymentId,
          rows.map((row) => row.id),
        ),
        isNull(tables.paymentAllocation.reversedAt),
      ),
    );

  return rows.map((row) => {
    const mine = allocations.filter((allocation) => allocation.paymentId === row.id);
    const allocated = sumMoney(mine.map((allocation) => allocation.amount));
    return {
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      receivedOn: row.receivedOn,
      method: row.method as PaymentMethod | null,
      payerPersonId: row.payerPersonId,
      payerLabel: row.payerLabel,
      status: row.status as PaymentStatus,
      allocatedAmount: allocated,
      unallocatedAmount: outstandingOf(row.amount, allocated),
      allocations: mine.map((allocation) => ({
        id: allocation.id,
        rentTermId: allocation.rentTermId,
        periodStart: allocation.periodStart,
        amount: allocation.amount,
        allocatedOn: allocation.allocatedOn,
      })),
      version: row.version,
    };
  });
}

export async function depositFor(tx: Tx, leaseId: string): Promise<DepositRead> {
  const accounts = await tx
    .select()
    .from(tables.depositAccount)
    .where(eq(tables.depositAccount.leaseId, leaseId))
    .limit(1);
  const account = accounts[0];
  if (!account) {
    return {
      leaseId,
      accountId: null,
      contractualAmount: null,
      balanceAmount: ZERO,
      status: null,
      restitutionDueOn: null,
      movements: [],
      version: null,
    };
  }
  const movements = await tx
    .select()
    .from(tables.depositMovement)
    .where(eq(tables.depositMovement.depositAccountId, account.id))
    .orderBy(asc(tables.depositMovement.occurredOn));
  return {
    leaseId,
    accountId: account.id,
    contractualAmount: account.contractualAmount,
    // F10: the balance is derived from the movements, never stored.
    balanceAmount: sumMoney(
      movements.map((movement) =>
        movement.kind === "received" || movement.kind === "interest"
          ? movement.amount
          : `-${movement.amount}`,
      ),
    ),
    status: account.status as DepositAccountStatus,
    restitutionDueOn: account.restitutionDueOn,
    movements: movements.map((movement) => ({
      id: movement.id,
      kind: movement.kind as DepositMovementKind,
      amount: movement.amount,
      occurredOn: movement.occurredOn,
    })),
    version: account.version,
  };
}

export async function receiptsForLease(tx: Tx, leaseId: string): Promise<ReceiptRead[]> {
  const rows = await tx
    .select()
    .from(tables.rentReceipt)
    .where(eq(tables.rentReceipt.leaseId, leaseId))
    .orderBy(desc(tables.rentReceipt.issuedOn), desc(tables.rentReceipt.id));
  return rows.map((row) => ({
    id: row.id,
    leaseId: row.leaseId,
    kind: row.kind as RentReceiptKind,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    rentAmount: row.rentAmount,
    chargeAmount: row.chargeAmount,
    totalAmount: row.totalAmount,
    currency: row.currency,
    issuedOn: row.issuedOn,
    status: row.status as RentReceiptStatus,
    commandId: null,
  }));
}

export async function contactPointsFor(tx: Tx, personId: string): Promise<ContactPointRead[]> {
  const rows = await tx
    .select()
    .from(tables.contactPoint)
    .where(eq(tables.contactPoint.personId, personId))
    .orderBy(desc(tables.contactPoint.isPrimary));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as ContactPointRead["kind"],
    value: row.value,
    label: row.label,
    isPrimary: row.isPrimary,
    status: row.status as ContactPointRead["status"],
  }));
}

export async function personDetail(tx: Tx, personId: string): Promise<PersonDetail> {
  const rows = await tx.select().from(tables.person).where(eq(tables.person.id, personId)).limit(1);
  const person = rows[0];
  if (!person) throw new AppError("NOT_FOUND", { details: { personId } });

  const contactPoints = await contactPointsFor(tx, personId);
  const leaseRows = await tx
    .select()
    .from(tables.lease)
    .innerJoin(tables.leaseParty, eq(tables.leaseParty.leaseId, tables.lease.id))
    .where(eq(tables.leaseParty.personId, personId))
    .orderBy(desc(tables.lease.createdAt));
  const uniqueLeases = [...new Map(leaseRows.map((row) => [row.lease.id, row.lease])).values()];
  const leases = await leaseListItems(tx, uniqueLeases);

  return {
    id: person.id,
    kind: person.kind as PersonKind,
    displayName: person.displayName,
    status: person.status as PersonStatus,
    email: contactPoints.find((point) => point.kind === "email")?.value ?? null,
    phone:
      contactPoints.find((point) => point.kind === "mobile" || point.kind === "phone")?.value ??
      null,
    leaseCount: uniqueLeases.length,
    version: person.version,
    firstName: person.firstName,
    lastName: person.lastName,
    companyName: person.companyName,
    birthDate: person.birthDate,
    contactPoints,
    leases,
    balance: sumMoney(leases.map((lease) => lease.arrears)),
    createdAt: instant(person.createdAt),
  };
}
