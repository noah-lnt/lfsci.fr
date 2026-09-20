import type { Tx } from "@lfsci/db";
import { ensureObjectRef, mapExternal, tables, withTenant } from "@lfsci/db";
import { logger, toAppError } from "@lfsci/kernel";
import type { OdooAccountMove, OdooBankStatementLine } from "@lfsci/odoo";
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { withExchangeContext } from "../exchange-recorder";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.odoo.backsync");

export const CONNECTOR = "odoo";
export const MOVE_STREAM = "account.move";
export const STATEMENT_LINE_STREAM = "account.bank.statement.line";
export const PAGE_LIMIT = 200;

export const OdooBacksyncData = JobBase.extend({});
export type OdooBacksyncData = z.infer<typeof OdooBacksyncData>;

async function readCursor(
  deps: Deps,
  organizationId: string,
  stream: string,
): Promise<string | undefined> {
  return withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select({ cursorValue: tables.integrationCursor.cursorValue })
      .from(tables.integrationCursor)
      .where(
        and(
          eq(tables.integrationCursor.connector, CONNECTOR),
          eq(tables.integrationCursor.stream, stream),
        ),
      )
      .limit(1);
    return rows[0]?.cursorValue ?? undefined;
  });
}

async function saveCursor(
  deps: Deps,
  organizationId: string,
  stream: string,
  patch: { cursorValue?: string; error?: string },
): Promise<void> {
  const now = new Date().toISOString();
  await withTenant(deps.db, { organizationId }, async (tx) => {
    const base = {
      organizationId,
      connector: CONNECTOR,
      stream,
      cursorKind: "write_date_id" as const,
      overlapSeconds: 600,
      lastAttemptAt: now,
    };
    const success = patch.error === undefined;
    await tx
      .insert(tables.integrationCursor)
      .values({
        ...base,
        cursorValue: patch.cursorValue ?? null,
        lastSuccessAt: success ? now : null,
        lastError: patch.error ?? null,
        consecutiveFailures: success ? 0 : 1,
        health: success ? "healthy" : "degraded",
      })
      .onConflictDoUpdate({
        target: [
          tables.integrationCursor.organizationId,
          tables.integrationCursor.connector,
          tables.integrationCursor.stream,
        ],
        set: {
          lastAttemptAt: now,
          ...(patch.cursorValue === undefined ? {} : { cursorValue: patch.cursorValue }),
          ...(success
            ? { lastSuccessAt: now, lastError: null, consecutiveFailures: 0, health: "healthy" }
            : { lastError: patch.error ?? null, health: "degraded" }),
          updatedAt: now,
        },
      });
  });
}

function cents(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

type Mapping = { internalTable: string; internalId: string; objectRefId: string | null };

async function mappingFor(tx: Tx, model: string, externalId: number): Promise<Mapping | undefined> {
  const rows = await tx
    .select({
      internalTable: tables.externalRef.internalTable,
      internalId: tables.externalRef.internalId,
      objectRefId: tables.externalRef.objectRefId,
    })
    .from(tables.externalRef)
    .where(
      and(
        eq(tables.externalRef.model, model),
        eq(tables.externalRef.externalId, String(externalId)),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * SYN-05: a value Odoo now disagrees with is never overwritten silently. The
 * divergence is recorded and queued for the owner with both readings.
 */
async function openException(
  tx: Tx,
  input: {
    organizationId: string;
    objectRefId: string | null;
    reference: string;
    reason: string;
    payload: Record<string, unknown>;
  },
): Promise<boolean> {
  const existing = await tx
    .select({ id: tables.inboxItem.id })
    .from(tables.inboxItem)
    .where(
      and(
        eq(tables.inboxItem.source, "connector"),
        eq(tables.inboxItem.sourceReference, input.reference),
      ),
    )
    .limit(1);
  if (existing[0]) return false;

  if (input.objectRefId) {
    await tx.insert(tables.event).values({
      organizationId: input.organizationId,
      type: "odoo_divergence",
      primaryObjectRefId: input.objectRefId,
      occurredAt: new Date().toISOString(),
      origin: "odoo",
      payload: input.payload,
    });
  }
  await tx.insert(tables.inboxItem).values({
    organizationId: input.organizationId,
    source: "connector",
    sourceReference: input.reference,
    proposedObjectRefId: input.objectRefId,
    proposedAction: "review_odoo_divergence",
    uncertaintyReason: input.reason.slice(0, 500),
    status: "ambiguous",
  });
  return true;
}

export const CLAIM_INDEMNITY_TABLE = "claim_indemnity";

/** A supplier-side move is the repair cost of the claim, never its indemnity. */
const SUPPLIER_MOVE_TYPES = new Set(["in_invoice", "in_refund"]);

type ClaimMatch = { id: string; currency: string; ambiguous: boolean };

/**
 * SIN-01: Odoo stores no link to a claim. The only attribution it can carry is
 * the reference the owner writes on the entry, matched exactly against the
 * claim's own reference or the insurer's claim number. Two claims answering to
 * the same string is an ambiguity, never a pick.
 */
async function claimsByReference(tx: Tx): Promise<Map<string, ClaimMatch>> {
  const rows = await tx
    .select({
      id: tables.claim.id,
      reference: tables.claim.reference,
      insurerClaimNumber: tables.claim.insurerClaimNumber,
      currency: tables.claim.currency,
    })
    .from(tables.claim);

  const byReference = new Map<string, ClaimMatch>();
  for (const row of rows) {
    for (const candidate of [row.reference, row.insurerClaimNumber]) {
      const key = candidate?.trim();
      if (!key) continue;
      const seen = byReference.get(key);
      byReference.set(key, {
        id: seen?.id ?? row.id,
        currency: seen?.currency ?? row.currency,
        ambiguous: Boolean(seen && seen.id !== row.id),
      });
    }
  }
  return byReference;
}

/**
 * SIN-01: the indemnity is cash and the ledger is its authority, so the row is
 * written from the move, not from the claims screen. `kind` is the only part
 * Odoo cannot say: a customer credit note withholds instead of paying, so it is
 * recorded as a deductible and reported apart; everything else is cash in, the
 * first one an advance and the next ones complements. `final` is never inferred
 * — nothing in Odoo says the insurer closed the file.
 */
async function applyClaimMove(
  tx: Tx,
  organizationId: string,
  odooDatabase: string,
  move: OdooAccountMove,
  claims: Map<string, ClaimMatch>,
  mapping: Mapping | undefined,
): Promise<"skipped" | "written" | "ambiguous"> {
  if (move.state !== "posted" || SUPPLIER_MOVE_TYPES.has(move.move_type)) return "skipped";
  const reference = typeof move.ref === "string" ? move.ref.trim() : "";
  const claim = reference ? claims.get(reference) : undefined;
  if (!claim) return "skipped";

  const objectRefId = await ensureObjectRef(tx, { organizationId, kind: "claim", id: claim.id });
  if (claim.ambiguous) {
    const opened = await openException(tx, {
      organizationId,
      objectRefId,
      reference: `account.move:${move.id}:claim`,
      reason: `la référence « ${reference} » désigne plusieurs sinistres : l'indemnité n'est pas imputée`,
      payload: { odooId: move.id, odooRef: reference, amountTotal: move.amount_total },
    });
    return opened ? "ambiguous" : "skipped";
  }

  const cashIn = await tx
    .select({ id: tables.claimIndemnity.id })
    .from(tables.claimIndemnity)
    .where(
      and(
        eq(tables.claimIndemnity.claimId, claim.id),
        ne(tables.claimIndemnity.kind, "deductible"),
      ),
    )
    .limit(1);

  const rows = await tx
    .insert(tables.claimIndemnity)
    .values({
      organizationId,
      claimId: claim.id,
      amount: cents(move.amount_total),
      currency: claim.currency,
      receivedOn: typeof move.date === "string" ? move.date : null,
      kind:
        move.move_type === "out_refund"
          ? "deductible"
          : cashIn.length > 0
            ? "complement"
            : "advance",
    })
    .returning({ id: tables.claimIndemnity.id });
  const row = rows[0];
  if (!row) return "skipped";

  // The mapping is both the audit trail of the attribution and what keeps the
  // next pass from writing the same cash twice. A move already parked on the
  // catch-all is re-pointed: nobody had claimed it.
  if (mapping) {
    const now = new Date().toISOString();
    await tx
      .update(tables.externalRef)
      .set({
        internalId: row.id,
        internalTable: CLAIM_INDEMNITY_TABLE,
        objectRefId,
        lastReadAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tables.externalRef.model, MOVE_STREAM),
          eq(tables.externalRef.externalId, String(move.id)),
        ),
      );
  } else {
    await mapExternal(tx, {
      organizationId,
      model: MOVE_STREAM,
      externalId: move.id,
      internalId: row.id,
      internalTable: CLAIM_INDEMNITY_TABLE,
      odooDatabase,
      objectRefId,
    });
  }
  return "written";
}

async function refreshIndemnity(tx: Tx, move: OdooAccountMove, mapping: Mapping): Promise<void> {
  await tx
    .update(tables.claimIndemnity)
    .set({
      amount: cents(move.amount_total),
      ...(typeof move.date === "string" ? { receivedOn: move.date } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tables.claimIndemnity.id, mapping.internalId));
}

/**
 * LOY-02: Odoo is the authority for cash. What it says is settled on the term's
 * move becomes a payment and its allocation here, never the reverse.
 */
async function applyRentTermMove(
  tx: Tx,
  organizationId: string,
  move: OdooAccountMove,
  mapping: Mapping,
): Promise<{ paid: boolean; exception: boolean }> {
  const terms = await tx
    .select()
    .from(tables.rentTerm)
    .where(eq(tables.rentTerm.id, mapping.internalId))
    .limit(1);
  const term = terms[0];
  if (!term) return { paid: false, exception: false };

  const readAt = new Date().toISOString();
  const versions = term.currentVersionId
    ? await tx
        .select()
        .from(tables.rentTermVersion)
        .where(eq(tables.rentTermVersion.id, term.currentVersionId))
        .limit(1)
    : [];
  const version = versions[0];

  let exception = false;
  if (version && cents(move.amount_total) !== cents(Number(version.totalAmount))) {
    const objectRefId =
      mapping.objectRefId ??
      (await ensureObjectRef(tx, { organizationId, kind: "rent_term", id: term.id }));
    exception = await openException(tx, {
      organizationId,
      objectRefId,
      reference: `account.move:${move.id}:amount`,
      reason: `le montant de l'écriture Odoo (${cents(move.amount_total)}) diffère du terme (${version.totalAmount})`,
      payload: {
        odooId: move.id,
        odooName: move.name,
        ledgerAmount: cents(move.amount_total),
        expectedAmount: version.totalAmount,
      },
    });
  }
  if (version) {
    await tx
      .update(tables.rentTermVersion)
      .set({ odooMoveId: move.id, odooMoveName: move.name || null, odooReadAt: readAt })
      .where(eq(tables.rentTermVersion.id, version.id));
  }

  const settled = Math.round((move.amount_total - move.amount_residual) * 100) / 100;
  if (settled <= 0) return { paid: false, exception };

  const allocatedRows = await tx.execute<{ total: string | null }>(sql`
    SELECT sum(amount) AS total
      FROM payment_allocation
     WHERE rent_term_id = ${term.id}::uuid AND reversed_at IS NULL
  `);
  const allocated = Number([...allocatedRows][0]?.total ?? 0);
  const delta = Math.round((settled - allocated) * 100) / 100;
  if (delta <= 0) return { paid: false, exception };

  const leases = await tx
    .select({ legalEntityId: tables.lease.legalEntityId })
    .from(tables.lease)
    .where(eq(tables.lease.id, term.leaseId))
    .limit(1);
  const legalEntityId = leases[0]?.legalEntityId;
  if (!legalEntityId) return { paid: false, exception };

  const receivedOn = typeof move.date === "string" ? move.date : term.dueOn;
  const currency = version?.currency ?? "EUR";
  const payments = await tx
    .insert(tables.payment)
    .values({
      organizationId,
      legalEntityId,
      direction: "inbound",
      amount: cents(delta),
      currency,
      receivedOn,
      status: "allocated",
      payerLabel: move.partner_id === false ? null : move.partner_id[1],
      odooReadAt: readAt,
    })
    .returning({ id: tables.payment.id });
  const payment = payments[0];
  if (!payment) return { paid: false, exception };

  await tx.insert(tables.paymentAllocation).values({
    organizationId,
    paymentId: payment.id,
    rentTermId: term.id,
    amount: cents(delta),
    currency,
    allocatedOn: receivedOn,
    confirmedByOdoo: true,
    odooReconcileRef: move.name || null,
    odooReadAt: readAt,
  });

  const fullySettled = Math.round(move.amount_residual * 100) === 0;
  await tx
    .update(tables.rentTerm)
    .set({
      status: fullySettled ? "settled" : "partially_settled",
      ...(fullySettled ? { settledAt: readAt } : {}),
      updatedAt: readAt,
    })
    .where(eq(tables.rentTerm.id, term.id));

  return { paid: true, exception };
}

async function applyExpenseMove(tx: Tx, move: OdooAccountMove, mapping: Mapping): Promise<void> {
  const readAt = new Date().toISOString();
  const settled = Math.round(move.amount_residual * 100) === 0;
  await tx
    .update(tables.expense)
    .set({
      odooMoveId: move.id,
      odooMoveName: move.name || null,
      odooReadAt: readAt,
      ...(settled ? { status: "paid" } : {}),
      updatedAt: readAt,
    })
    .where(eq(tables.expense.id, mapping.internalId));
}

async function applyStatementLine(
  tx: Tx,
  organizationId: string,
  line: OdooBankStatementLine,
): Promise<boolean> {
  const readAt = new Date().toISOString();
  const mapping = await mappingFor(tx, STATEMENT_LINE_STREAM, line.id);

  if (mapping?.internalTable === "payment") {
    await tx
      .update(tables.payment)
      .set({ odooReadAt: readAt, updatedAt: readAt })
      .where(eq(tables.payment.id, mapping.internalId));
    return true;
  }

  const updated = await tx
    .update(tables.bankTransaction)
    .set({ readAt, updatedAt: readAt })
    .where(
      and(
        eq(tables.bankTransaction.organizationId, organizationId),
        eq(tables.bankTransaction.odooStatementLineId, line.id),
      ),
    )
    .returning({ id: tables.bankTransaction.id });
  return updated.length > 0;
}

export async function backsyncOrganization(
  deps: Deps,
  organizationId: string,
): Promise<{
  read: number;
  payments: number;
  indemnities: number;
  exceptions: number;
  advanced: boolean;
}> {
  const odoo = deps.odoo;
  if (!odoo) return { read: 0, payments: 0, indemnities: 0, exceptions: 0, advanced: false };

  const moveCursor = await readCursor(deps, organizationId, MOVE_STREAM);
  const page = await withExchangeContext({ organizationId, commandId: null }, () =>
    odoo.operations.readAccountMoves(undefined, moveCursor, { limit: PAGE_LIMIT }),
  );

  let payments = 0;
  let indemnities = 0;
  let exceptions = 0;

  if (page.records.length > 0) {
    // The cursor advances only after the whole page is persisted (SYN-04).
    const applied = await withTenant(deps.db, { organizationId }, async (tx) => {
      const entities = await tx
        .select({ id: tables.legalEntity.id })
        .from(tables.legalEntity)
        .limit(1);
      const entity = entities[0];
      const entityRefId = entity
        ? await ensureObjectRef(tx, { organizationId, kind: "legal_entity", id: entity.id })
        : null;
      const claims = await claimsByReference(tx);
      let paid = 0;
      let written = 0;
      let opened = 0;

      for (const move of page.records) {
        const mapping = await mappingFor(tx, MOVE_STREAM, move.id);

        if (mapping?.internalTable === "rent_term") {
          const outcome = await applyRentTermMove(tx, organizationId, move, mapping);
          if (outcome.paid) paid += 1;
          if (outcome.exception) opened += 1;
          continue;
        }
        if (mapping?.internalTable === "expense") {
          await applyExpenseMove(tx, move, mapping);
          continue;
        }
        if (mapping?.internalTable === CLAIM_INDEMNITY_TABLE) {
          await refreshIndemnity(tx, move, mapping);
          continue;
        }
        if (mapping?.internalTable === "cca_movement") {
          await tx
            .update(tables.ccaMovement)
            .set({ odooMoveId: move.id, odooReadAt: new Date().toISOString() })
            .where(eq(tables.ccaMovement.id, mapping.internalId));
          continue;
        }

        // An unclaimed move parks on the legal entity, so the attribution is
        // retried there too: the owner usually tags the entry after it was read.
        if (!mapping || mapping.internalTable === "legal_entity") {
          const attributed = await applyClaimMove(
            tx,
            organizationId,
            odoo.database,
            move,
            claims,
            mapping,
          );
          if (attributed === "written") {
            written += 1;
            continue;
          }
          if (attributed === "ambiguous") opened += 1;
        }

        if (!entityRefId || !entity) continue;
        if (!mapping) {
          // A move nobody claims belongs to the entity: it is recorded, never guessed.
          await mapExternal(tx, {
            organizationId,
            model: MOVE_STREAM,
            externalId: move.id,
            internalId: entity.id,
            internalTable: "legal_entity",
            odooDatabase: odoo.database,
            objectRefId: entityRefId,
          }).catch((error: unknown) => {
            log.debug({ moveId: move.id, err: toAppError(error).code }, "move not mapped");
          });
        }
        await tx.insert(tables.event).values({
          organizationId,
          type: "odoo_move_changed",
          primaryObjectRefId: entityRefId,
          occurredAt: new Date().toISOString(),
          origin: "odoo",
          payload: {
            odooId: move.id,
            name: move.name,
            state: move.state,
            moveType: move.move_type,
            amountTotal: move.amount_total,
            amountResidual: move.amount_residual,
            paymentState: move.payment_state,
            writeDate: move.write_date,
          },
        });
      }
      return { paid, written, opened };
    });
    payments += applied.paid;
    indemnities += applied.written;
    exceptions += applied.opened;
  }

  if (page.nextCursor && page.records.length > 0) {
    await saveCursor(deps, organizationId, MOVE_STREAM, { cursorValue: page.nextCursor });
  } else {
    await saveCursor(deps, organizationId, MOVE_STREAM, {});
  }

  const lineCursor = await readCursor(deps, organizationId, STATEMENT_LINE_STREAM);
  const lines = await withExchangeContext({ organizationId, commandId: null }, () =>
    odoo.operations.readBankStatementLines(undefined, lineCursor, { limit: PAGE_LIMIT }),
  );
  if (lines.records.length > 0) {
    await withTenant(deps.db, { organizationId }, async (tx) => {
      for (const line of lines.records) await applyStatementLine(tx, organizationId, line);
    });
    if (lines.nextCursor) {
      await saveCursor(deps, organizationId, STATEMENT_LINE_STREAM, {
        cursorValue: lines.nextCursor,
      });
    }
  } else {
    await saveCursor(deps, organizationId, STATEMENT_LINE_STREAM, {});
  }

  await mirrorJournalBalances(deps, organizationId);

  return {
    read: page.records.length + lines.records.length,
    payments,
    indemnities,
    exceptions,
    advanced: Boolean(page.nextCursor) && page.records.length > 0,
  };
}

/**
 * BAN-01: the ledger's balance is copied, dated, never derived here. Its date
 * is the last statement line mirrored for that account, since that is what the
 * journal's running balance reflects; with no line yet it is the read date.
 */
export async function mirrorJournalBalances(deps: Deps, organizationId: string): Promise<number> {
  const odoo = deps.odoo;
  if (!odoo) return 0;

  const accounts = await withTenant(deps.db, { organizationId }, (tx) =>
    tx
      .select({ id: tables.bankAccount.id, journalId: tables.bankAccount.odooJournalId })
      .from(tables.bankAccount)
      .where(isNotNull(tables.bankAccount.odooJournalId)),
  );
  const journalIds = accounts
    .map((account) => account.journalId)
    .filter((id): id is number => id !== null);
  if (journalIds.length === 0) return 0;

  const journals = await withExchangeContext({ organizationId, commandId: null }, () =>
    odoo.operations.readBankJournalBalances({ journalIds }),
  );
  const balanceByJournal = new Map(
    journals
      .filter((journal) => journal.current_statement_balance !== false)
      .map((journal) => [journal.id, Number(journal.current_statement_balance).toFixed(2)]),
  );

  const readAt = deps.now().toISOString();
  return withTenant(deps.db, { organizationId }, async (tx) => {
    let written = 0;
    for (const account of accounts) {
      const balance =
        account.journalId === null ? undefined : balanceByJournal.get(account.journalId);
      if (balance === undefined) continue;
      const latest = await tx
        .select({ bookedOn: sql<string | null>`max(${tables.bankTransaction.bookedOn})` })
        .from(tables.bankTransaction)
        .where(
          and(
            eq(tables.bankTransaction.bankAccountId, account.id),
            isNotNull(tables.bankTransaction.odooStatementLineId),
          ),
        );
      const balanceOn = latest[0]?.bookedOn ?? readAt.slice(0, 10);
      await tx
        .update(tables.bankAccount)
        .set({ odooBalance: balance, odooBalanceOn: balanceOn, odooReadAt: readAt })
        .where(eq(tables.bankAccount.id, account.id));
      written += 1;
    }
    return written;
  });
}

export async function backsync(deps: Deps): Promise<JobOutcome> {
  if (!deps.odoo) return { outcome: "sources_unavailable", missing: ["odoo"] };

  const organizationIds = await forEachOrganizationId(deps);
  let read = 0;
  let payments = 0;
  let indemnities = 0;
  let exceptions = 0;
  const failures: string[] = [];

  for (const organizationId of organizationIds) {
    try {
      const result = await backsyncOrganization(deps, organizationId);
      read += result.read;
      payments += result.payments;
      indemnities += result.indemnities;
      exceptions += result.exceptions;
    } catch (error) {
      const appError = toAppError(error);
      failures.push(`${organizationId}: ${appError.code}`);
      await saveCursor(deps, organizationId, MOVE_STREAM, {
        error: appError.message.slice(0, 500),
      });
    }
  }

  if (organizationIds.length > 0 && failures.length === organizationIds.length) {
    throw new Error(`odoo back-sync failed everywhere: ${failures.join("; ")}`);
  }
  return {
    outcome: "synced",
    organizations: organizationIds.length,
    read,
    payments,
    indemnities,
    exceptions,
    failures,
  };
}

export const odooBacksync = defineJob({
  name: "odoo.backsync",
  schema: OdooBacksyncData,
  options: {
    retryLimit: 2,
    retryDelay: 120,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 900,
    localConcurrency: 1,
  },
  schedule: { cron: "*/10 * * * *", tz: "Europe/Paris" },
  handler: (_data, deps) => backsync(deps),
});
