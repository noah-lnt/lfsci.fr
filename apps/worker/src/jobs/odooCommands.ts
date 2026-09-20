import type { CommandRow, Tx } from "@lfsci/db";
import { createCommand, enqueueOutbox, tables, transitionCommand, withTenant } from "@lfsci/db";
import { money, sum, toMoney } from "@lfsci/domain";
import { AppError } from "@lfsci/kernel";
import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Deps, OdooPort } from "../deps";
import { renderPdf } from "./pdfRender";

export type OperationResult = {
  externalId: number | null;
  model: string | null;
  internalTable: string | null;
  internalId: string | null;
  /** Local effect of the confirmed operation, applied in the same transaction. */
  apply?: (tx: Tx) => Promise<void>;
};

const PARTNER_REF_PREFIX = "LFSCI-PERS-";

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("VALIDATION", {
      message: `champ ${key} absent de la commande`,
      details: { key },
    });
  }
  return value;
}

function amountOf(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "0";
}

/**
 * A tenant, partner or supplier reaches Odoo as a `res.partner` keyed by the
 * person's id: the SaaS owns the identity, Odoo holds a copy.
 */
async function ensurePartner(
  deps: Deps,
  odoo: OdooPort,
  organizationId: string,
  personId: string,
): Promise<number> {
  const person = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(tables.person)
      .where(eq(tables.person.id, personId))
      .limit(1);
    return rows[0];
  });
  if (!person) throw new AppError("NOT_FOUND", { details: { personId } });
  if (person.odooPartnerId !== null) return person.odooPartnerId;

  const ref = `${PARTNER_REF_PREFIX}${person.id}`;
  const existing = await odoo.operations.findPartnerByRef(ref);
  const partnerId =
    existing?.id ??
    (
      await odoo.operations.createPartner({
        name: person.displayName,
        ref,
        isCompany: person.kind === "legal",
      })
    ).id;

  await withTenant(deps.db, { organizationId }, async (tx) => {
    await tx
      .update(tables.person)
      .set({ odooPartnerId: partnerId, updatedAt: new Date().toISOString() })
      .where(eq(tables.person.id, person.id));
  });
  return partnerId;
}

type RentContext = {
  rentTermId: string;
  versionId: string | null;
  partnerId: number;
  companyId: number | undefined;
  reference: string;
  unit: { code: string; label: string } | undefined;
};

async function rentContext(
  deps: Deps,
  odoo: OdooPort,
  organizationId: string,
  rentTermId: string,
  periodStart: string,
): Promise<RentContext> {
  const read = await withTenant(deps.db, { organizationId }, async (tx) => {
    const terms = await tx
      .select()
      .from(tables.rentTerm)
      .where(eq(tables.rentTerm.id, rentTermId))
      .limit(1);
    const term = terms[0];
    if (!term) throw new AppError("NOT_FOUND", { details: { rentTermId } });

    const leases = await tx
      .select()
      .from(tables.lease)
      .where(eq(tables.lease.id, term.leaseId))
      .limit(1);
    const lease = leases[0];
    if (!lease) throw new AppError("NOT_FOUND", { details: { leaseId: term.leaseId } });

    const entities = await tx
      .select({ odooCompanyId: tables.legalEntity.odooCompanyId })
      .from(tables.legalEntity)
      .where(eq(tables.legalEntity.id, lease.legalEntityId))
      .limit(1);

    // The invoice goes to the billing contact when the lease names one, else to
    // the holder; a guarantor or the landlord is never billed.
    const parties = await tx
      .select()
      .from(tables.leaseParty)
      .where(
        and(
          eq(tables.leaseParty.leaseId, lease.id),
          inArray(tables.leaseParty.role, ["holder", "co_holder", "payer_third_party"]),
          or(isNull(tables.leaseParty.endsOn), sql`${tables.leaseParty.endsOn} >= ${periodStart}`),
        ),
      )
      .orderBy(
        sql`is_billing_contact DESC`,
        sql`CASE role WHEN 'holder' THEN 0 WHEN 'co_holder' THEN 1 ELSE 2 END`,
        asc(tables.leaseParty.startsOn),
      );
    const party = parties[0];
    if (!party) {
      throw new AppError("NOT_FOUND", {
        message: "bail sans locataire actif : aucun tiers à facturer",
        details: { leaseId: lease.id, periodStart },
      });
    }

    const units = await tx
      .select({ code: tables.unit.code, label: tables.unit.label })
      .from(tables.leaseUnit)
      .innerJoin(tables.unit, eq(tables.unit.id, tables.leaseUnit.unitId))
      .where(and(eq(tables.leaseUnit.leaseId, lease.id), eq(tables.leaseUnit.role, "main")))
      .limit(1);

    return {
      term,
      reference: lease.reference,
      personId: party.personId,
      companyId: entities[0]?.odooCompanyId ?? undefined,
      unit: units[0],
    };
  });

  return {
    rentTermId,
    versionId: read.term.currentVersionId,
    partnerId: await ensurePartner(deps, odoo, organizationId, read.personId),
    companyId: read.companyId ?? undefined,
    reference: read.reference,
    unit: read.unit,
  };
}

async function prepareRentAccounting(
  deps: Deps,
  odoo: OdooPort,
  command: CommandRow,
  operationRef: string,
): Promise<OperationResult> {
  const payload = command.payload as Record<string, unknown>;
  const rentTermId = requireString(payload, "rentTermId");
  const periodStart = requireString(payload, "periodStart");
  const dueOn = requireString(payload, "dueOn");
  const context = await rentContext(deps, odoo, command.organizationId, rentTermId, periodStart);

  const move = await odoo.operations.postRentInvoice({
    partnerId: context.partnerId,
    invoiceDate: dueOn,
    accountingDate: dueOn,
    rentAmount: amountOf(payload, "rentAmount"),
    chargeAmount: amountOf(payload, "chargeAmount"),
    accessoryAmount: amountOf(payload, "accessoryAmount"),
    ref: `${context.reference} ${periodStart}`,
    operationRef,
    ...(context.unit ? { unit: { code: context.unit.code, label: context.unit.label } } : {}),
    ...(context.companyId === undefined ? {} : { companyId: context.companyId }),
  });

  const versionId = context.versionId;
  return {
    externalId: move.id,
    model: "account.move",
    internalTable: "rent_term",
    internalId: rentTermId,
    apply: async (tx) => {
      const readAt = new Date().toISOString();
      if (versionId) {
        await tx
          .update(tables.rentTermVersion)
          .set({
            isPosted: true,
            odooMoveId: move.id,
            odooMoveName: move.name,
            odooReadAt: readAt,
            updatedAt: readAt,
          })
          .where(eq(tables.rentTermVersion.id, versionId));
      }
      await tx
        .update(tables.rentTerm)
        .set({ status: "posted", postedAt: readAt, updatedAt: readAt })
        .where(eq(tables.rentTerm.id, rentTermId));
    },
  };
}

/** The move the receipt belongs to is the one posted for the term of the same period. */
async function receiptMoveId(
  deps: Deps,
  odoo: OdooPort,
  organizationId: string,
  leaseId: string,
  periodStart: string,
): Promise<number> {
  const found = await withTenant(deps.db, { organizationId }, async (tx) => {
    const terms = await tx
      .select({ id: tables.rentTerm.id })
      .from(tables.rentTerm)
      .where(
        and(
          eq(tables.rentTerm.leaseId, leaseId),
          eq(tables.rentTerm.periodStart, periodStart),
          eq(tables.rentTerm.kind, "rent"),
        ),
      )
      .limit(1);
    const term = terms[0];
    if (!term) return undefined;
    const refs = await tx
      .select({ externalId: tables.externalRef.externalId })
      .from(tables.externalRef)
      .where(
        and(
          eq(tables.externalRef.model, "account.move"),
          eq(tables.externalRef.internalTable, "rent_term"),
          eq(tables.externalRef.internalId, term.id),
        ),
      )
      .limit(1);
    return refs[0]?.externalId;
  });
  if (!found) {
    throw new AppError("NOT_FOUND", {
      message: "aucune écriture Odoo pour ce terme : la quittance ne peut y être attachée",
      details: { leaseId, periodStart, odooDatabase: odoo.database },
    });
  }
  return Number(found);
}

async function issueReceipt(
  deps: Deps,
  odoo: OdooPort,
  command: CommandRow,
  operationRef: string,
): Promise<OperationResult> {
  const payload = command.payload as Record<string, unknown>;
  const organizationId = command.organizationId;
  const leaseId = requireString(payload, "leaseId");
  const periodStart = requireString(payload, "periodStart");
  const kind = requireString(payload, "kind");

  const receipt = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(tables.rentReceipt)
      .where(
        and(
          eq(tables.rentReceipt.leaseId, leaseId),
          eq(tables.rentReceipt.periodStart, periodStart),
          eq(tables.rentReceipt.kind, kind),
        ),
      )
      .limit(1);
    return rows[0];
  });
  if (!receipt) {
    throw new AppError("NOT_FOUND", { details: { leaseId, periodStart, kind } });
  }

  if (!receipt.documentId) {
    await renderPdf(deps, {
      organizationId,
      rentReceiptId: receipt.id,
      template: kind === "quittance" ? "quittance" : "recu",
      requestId: command.correlationId ?? undefined,
    });
  }

  const version = await withTenant(deps.db, { organizationId }, async (tx) => {
    const refreshed = await tx
      .select({ documentId: tables.rentReceipt.documentId })
      .from(tables.rentReceipt)
      .where(eq(tables.rentReceipt.id, receipt.id))
      .limit(1);
    const documentId = refreshed[0]?.documentId;
    if (!documentId) return undefined;
    const rows = await tx
      .select()
      .from(tables.documentVersion)
      .where(eq(tables.documentVersion.documentId, documentId))
      .orderBy(sql`sequence DESC`)
      .limit(1);
    return rows[0];
  });
  if (!version) {
    throw new AppError("NOT_FOUND", {
      message: "quittance sans fichier rendu",
      details: { rentReceiptId: receipt.id },
    });
  }

  // The move is resolved before the file is fetched: a receipt with nowhere to go
  // must not cost a download.
  const moveId = await receiptMoveId(deps, odoo, organizationId, leaseId, periodStart);
  const created = await odoo.operations.attachDocument({
    name: `${kind}-${periodStart}.pdf`,
    base64: await downloadBase64(deps, version.storageKey),
    resModel: "account.move",
    resId: moveId,
    mimetype: version.contentType ?? "application/pdf",
    operationRef,
  });

  return {
    externalId: created.id,
    model: "ir.attachment",
    internalTable: "document_version",
    internalId: version.id,
  };
}

async function downloadBase64(deps: Deps, key: string): Promise<string> {
  if (!deps.storage) {
    throw new AppError("RULE_VIOLATION", {
      message: "stockage non configuré : le document ne peut être relu",
      details: { key },
    });
  }
  const url = await deps.storage.presignDownload({ key });
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      message: "téléchargement du document impossible",
      details: { status: response.status },
    });
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

async function recordCcaMovement(
  deps: Deps,
  odoo: OdooPort,
  command: CommandRow,
  operationRef: string,
): Promise<OperationResult> {
  const payload = command.payload as Record<string, unknown>;
  const organizationId = command.organizationId;
  const ccaId = requireString(payload, "ccaId");
  const movementId = requireString(payload, "ccaMovementId");

  const context = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select()
      .from(tables.partnerCurrentAccount)
      .where(eq(tables.partnerCurrentAccount.id, ccaId))
      .limit(1);
    const account = rows[0];
    if (!account) throw new AppError("NOT_FOUND", { details: { ccaId } });
    const entities = await tx
      .select({ odooCompanyId: tables.legalEntity.odooCompanyId })
      .from(tables.legalEntity)
      .where(eq(tables.legalEntity.id, account.legalEntityId))
      .limit(1);
    return {
      personId: account.partnerPersonId,
      companyId: entities[0]?.odooCompanyId ?? undefined,
    };
  });

  const partnerId = await ensurePartner(deps, odoo, organizationId, context.personId);
  const move = await odoo.operations.postCcaEntry({
    kind: requireString(payload, "kind") as Parameters<
      typeof odoo.operations.postCcaEntry
    >[0]["kind"],
    amount: amountOf(payload, "amount"),
    accountingDate: requireString(payload, "occurredOn"),
    label: requireString(payload, "justification").slice(0, 200),
    partnerId,
    operationRef,
    ...(context.companyId === undefined ? {} : { companyId: context.companyId }),
  });

  return {
    externalId: move.id,
    model: "account.move",
    internalTable: "cca_movement",
    internalId: movementId,
    apply: async (tx) => {
      const readAt = new Date().toISOString();
      await tx
        .update(tables.ccaMovement)
        .set({ status: "posted", odooMoveId: move.id, odooReadAt: readAt, updatedAt: readAt })
        .where(eq(tables.ccaMovement.id, movementId));
    },
  };
}

type BillLine = {
  name: string;
  priceUnit: number;
  accountId?: number;
  analyticDistribution?: Record<string, number>;
};

/**
 * Shares are whole percentages of one analytic plan: the remainder lands on the
 * largest share so the distribution always totals 100.
 */
function analyticShares(rows: { code: string; amount: number }[]): Record<string, number> {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (total === 0) return {};
  const shares = rows.map((row) => ({
    code: row.code,
    value: Math.round((row.amount / total) * 100),
  }));
  const sum = shares.reduce((acc, share) => acc + share.value, 0);
  const largest = shares.reduce((best, share) => (share.value > best.value ? share : best));
  largest.value += 100 - sum;
  const distribution: Record<string, number> = {};
  for (const share of shares) {
    if (share.value > 0) distribution[share.code] = (distribution[share.code] ?? 0) + share.value;
  }
  return distribution;
}

async function supplierBillLines(
  deps: Deps,
  odoo: OdooPort,
  organizationId: string,
  expenseId: string,
): Promise<BillLine[]> {
  const rows = await withTenant(deps.db, { organizationId }, async (tx) => {
    const lines = await tx
      .select()
      .from(tables.expenseLine)
      .where(eq(tables.expenseLine.expenseId, expenseId))
      .orderBy(asc(tables.expenseLine.lineNumber));
    if (lines.length === 0) return { lines, allocations: [] };
    const allocations = await tx
      .select({
        expenseLineId: tables.expenseAllocation.expenseLineId,
        amount: tables.expenseAllocation.amount,
        code: tables.unit.code,
        label: tables.unit.label,
      })
      .from(tables.expenseAllocation)
      .innerJoin(tables.unit, eq(tables.unit.id, tables.expenseAllocation.unitId))
      .where(
        inArray(
          tables.expenseAllocation.expenseLineId,
          lines.map((line) => line.id),
        ),
      );
    return { lines, allocations };
  });

  const out: BillLine[] = [];
  for (const line of rows.lines) {
    const allocations = rows.allocations.filter((row) => row.expenseLineId === line.id);
    const shares = analyticShares(
      allocations.map((row) => ({ code: row.code, amount: Number(row.amount) })),
    );
    const distribution: Record<string, number> = {};
    for (const [code, share] of Object.entries(shares)) {
      const label = allocations.find((row) => row.code === code)?.label;
      const analyticId = await odoo.operations.ensureAnalyticAccount({
        code,
        ...(label === undefined ? {} : { label }),
      });
      distribution[String(analyticId)] = share;
    }
    out.push({
      name: line.description,
      priceUnit: Number(line.amountExclTax ?? line.amountInclTax),
      ...(line.accountHint
        ? { accountId: await odoo.operations.resolveAccountId(line.accountHint) }
        : {}),
      ...(Object.keys(distribution).length > 0 ? { analyticDistribution: distribution } : {}),
    });
  }
  return out;
}

async function postSupplierBill(
  deps: Deps,
  odoo: OdooPort,
  command: CommandRow,
  operationRef: string,
): Promise<OperationResult> {
  const payload = command.payload as Record<string, unknown>;
  const organizationId = command.organizationId;
  const expenseId = requireString(payload, "expenseId");
  const supplierReference = requireString(payload, "supplierReference");
  const issuedOn = requireString(payload, "issuedOn");

  const partner = await odoo.operations.findPartnerByRef(supplierReference);
  if (!partner) {
    throw new AppError("NOT_FOUND", {
      message: "fournisseur absent d'Odoo",
      details: { supplierReference },
    });
  }

  const companyId = await withTenant(deps.db, { organizationId }, async (tx) => {
    const rows = await tx
      .select({ odooCompanyId: tables.legalEntity.odooCompanyId })
      .from(tables.legalEntity)
      .innerJoin(tables.expense, eq(tables.expense.legalEntityId, tables.legalEntity.id))
      .where(eq(tables.expense.id, expenseId))
      .limit(1);
    return rows[0]?.odooCompanyId ?? undefined;
  });

  const lines = await supplierBillLines(deps, odoo, organizationId, expenseId);
  const created = await odoo.operations.createDraftSupplierBill({
    partnerId: partner.id,
    invoiceDate: issuedOn,
    accountingDate: issuedOn,
    ref: supplierReference,
    // No captured line: the total stands in for a detail the extraction did not produce.
    lines:
      lines.length > 0
        ? lines
        : [{ name: supplierReference, priceUnit: Number(payload.totalExclTax) }],
    operationRef,
    ...(companyId === undefined ? {} : { companyId }),
  });

  return {
    externalId: created.id,
    model: "account.move",
    internalTable: "expense",
    internalId: expenseId,
    apply: async (tx) => {
      const readAt = new Date().toISOString();
      await tx
        .update(tables.expense)
        .set({ status: "posted", odooMoveId: created.id, odooReadAt: readAt, updatedAt: readAt })
        .where(eq(tables.expense.id, expenseId));
    },
  };
}

/** A revision never rewrites an obligation already posted: that is an adjustment (MOD-03). */
const REVISABLE_TERM_STATUSES = ["planned", "authorized"] as const;

/**
 * A prepared command bills from the payload frozen at preparation, so a revised
 * term leaves it showing the old rent. It is cancelled, never rewritten, and
 * replaced by one carrying the new version's amounts; a command already sent is
 * history and is left alone.
 */
async function reprepareRentAccounting(
  tx: Tx,
  term: typeof tables.rentTerm.$inferSelect,
  version: typeof tables.rentTermVersion.$inferSelect,
): Promise<void> {
  const stale = await tx
    .select()
    .from(tables.command)
    .where(
      and(
        eq(tables.command.commandType, "prepare_rent_accounting"),
        inArray(tables.command.status, ["prepared", "authorized"]),
        sql`${tables.command.payload} ->> 'rentTermId' = ${term.id}`,
      ),
    );
  if (stale.length === 0) return;

  const stamp = new Date().toISOString();
  for (const row of stale) {
    await transitionCommand(tx, row.id, row.status, "cancelled", row.version, {
      errorType: "version_conflict",
      errorDetail: "loyer révisé : la commande est repréparée sur le nouveau montant",
    });
    await tx
      .update(tables.outboxEntry)
      .set({ status: "cancelled", updatedAt: stamp })
      .where(
        and(
          eq(tables.outboxEntry.commandId, row.id),
          inArray(tables.outboxEntry.status, ["pending", "failed"]),
        ),
      );
  }

  const replacement = await createCommand(tx, {
    organizationId: term.organizationId,
    commandType: "prepare_rent_accounting",
    // The version that justifies it keeps the key unique: the cancelled command
    // still holds `prepare_rent_accounting:<termId>`.
    operationKey: `prepare_rent_accounting:${term.id}:${version.id}`,
    payload: {
      rentTermId: term.id,
      kind: term.kind,
      periodStart: term.periodStart,
      periodEnd: term.periodEnd,
      dueOn: term.dueOn,
      rentAmount: version.rentAmount,
      chargeAmount: version.chargeAmount,
      accessoryAmount: version.accessoryAmount,
      totalAmount: version.totalAmount,
      currency: version.currency,
    },
    autonomyLevel: "C",
    status: "prepared",
  });
  await enqueueOutbox(tx, {
    organizationId: term.organizationId,
    kind: "odoo",
    commandId: replacement.id,
    payload: replacement.payload,
    payloadHash: replacement.payloadHash,
    // Not runnable until a human authorizes it, as at first preparation.
    availableAt: new Date(Date.UTC(2999, 0, 1)).toISOString(),
  });
}

/**
 * IRL-01: the revision has no Odoo entry point of its own — the new rent reaches
 * Odoo with the term that carries it. Approving the command only fixes the local
 * effect, and `rent_revision.status` is what makes a replay write nothing.
 */
async function applyRentRevision(command: CommandRow): Promise<OperationResult> {
  const payload = command.payload as Record<string, unknown>;
  const rentRevisionId = requireString(payload, "rentRevisionId");
  const leaseId = requireString(payload, "leaseId");
  const effectiveOn = requireString(payload, "effectiveOn");
  const proposedRent = requireString(payload, "proposedRent");
  const currency = requireString(payload, "currency");

  return {
    externalId: null,
    model: null,
    internalTable: null,
    internalId: null,
    apply: async (tx) => {
      const stamp = new Date().toISOString();
      const claimed = await tx
        .update(tables.rentRevision)
        .set({ status: "applied", updatedAt: stamp })
        .where(
          and(
            eq(tables.rentRevision.id, rentRevisionId),
            ne(tables.rentRevision.status, "applied"),
          ),
        )
        .returning({ id: tables.rentRevision.id });
      if (claimed.length === 0) return;

      const terms = await tx
        .select()
        .from(tables.rentTerm)
        .where(
          and(
            eq(tables.rentTerm.leaseId, leaseId),
            eq(tables.rentTerm.kind, "rent"),
            gte(tables.rentTerm.periodStart, effectiveOn),
            inArray(tables.rentTerm.status, [...REVISABLE_TERM_STATUSES]),
          ),
        )
        .orderBy(asc(tables.rentTerm.periodStart));

      for (const term of terms) {
        const versions = await tx
          .select()
          .from(tables.rentTermVersion)
          .where(eq(tables.rentTermVersion.rentTermId, term.id))
          .orderBy(asc(tables.rentTermVersion.sequence));
        const current = versions.find((row) => row.id === term.currentVersionId) ?? versions.at(-1);
        const chargeAmount = current?.chargeAmount ?? "0.00";
        const accessoryAmount = current?.accessoryAmount ?? "0.00";
        const inserted = await tx
          .insert(tables.rentTermVersion)
          .values({
            organizationId: command.organizationId,
            rentTermId: term.id,
            sequence: versions.reduce((max, row) => Math.max(max, row.sequence), 0) + 1,
            rentAmount: proposedRent,
            chargeAmount,
            accessoryAmount,
            totalAmount: toMoney(
              sum([money(proposedRent), money(chargeAmount), money(accessoryAmount)]),
            ),
            currency,
            reason: "revision",
          })
          .returning();
        const version = inserted[0];
        if (!version) continue;
        await tx
          .update(tables.rentTerm)
          .set({ currentVersionId: version.id, updatedAt: stamp })
          .where(eq(tables.rentTerm.id, term.id));
        await reprepareRentAccounting(tx, term, version);
      }
    },
  };
}

/**
 * One typed Odoo operation per command type. A type with no entry here has no
 * confirmed Odoo entry point yet and is refused terminally rather than guessed.
 */
export async function runOperation(
  deps: Deps,
  command: CommandRow,
  operationRef: string,
): Promise<OperationResult> {
  const odoo = deps.odoo;
  if (!odoo) {
    throw new AppError("RULE_VIOLATION", {
      message: "connecteur Odoo non configuré",
      details: { commandType: command.commandType },
    });
  }
  const payload = command.payload as Record<string, unknown>;

  switch (command.commandType) {
    case "prepare_rent_accounting":
      return prepareRentAccounting(deps, odoo, command, operationRef);

    case "post_supplier_bill":
      return postSupplierBill(deps, odoo, command, operationRef);

    case "issue_receipt":
      return issueReceipt(deps, odoo, command, operationRef);

    case "record_cca_movement":
      return recordCcaMovement(deps, odoo, command, operationRef);

    case "revise_rent":
      return applyRentRevision(command);

    case "attach_document_to_odoo": {
      const created = await odoo.operations.attachDocument({
        name: String(payload.documentId),
        base64: String(payload.base64 ?? ""),
        resModel: String(payload.odooModel),
        resId: Number(payload.odooRecordId),
        operationRef,
      });
      return {
        externalId: created.id,
        model: "ir.attachment",
        internalTable: "document_version",
        internalId: String(payload.documentVersionId),
      };
    }

    case "propose_reconciliation": {
      await odoo.operations.proposeReconciliation({
        statementLineId: Number(payload.bankTransactionId),
        moveLineIds: [],
        operationRef,
      });
      return { externalId: null, model: null, internalTable: null, internalId: null };
    }

    default:
      throw new AppError("RULE_VIOLATION", {
        message: `aucune opération Odoo typée pour la commande ${command.commandType}`,
        details: { commandType: command.commandType, reason: "no_typed_operation" },
      });
  }
}
