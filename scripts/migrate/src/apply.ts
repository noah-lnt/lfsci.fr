import type { DbHandle, Tx } from "@lfsci/db";
import { ensureObjectRef, type ObjectKind, tables, withTenant } from "@lfsci/db";
import { money, toMoney } from "@lfsci/domain";
import { newId } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import type {
  AssetRecord,
  ExpenseRecord,
  LeaseRecord,
  LoanRecord,
  MeterRecord,
  Plan,
  RecordKind,
  RentTermRecord,
  SourceRecord,
  Target,
} from "./model";
import { nameKey } from "./normalise";

export const IMPORT_EVENT_TYPE = "migration_import";
export const IMPORT_SOURCE_SYSTEM = "migration:odoo";

export type ApplyReport = {
  batchId: string;
  written: Partial<Record<RecordKind, number>>;
  alreadyImported: number;
  entities: { entityId: string; entityName: string; written: number }[];
};

export class ApplyRefused extends Error {}

type Ids = Map<string, string>;

function bump(counter: Partial<Record<RecordKind, number>>, kind: RecordKind): void {
  counter[kind] = (counter[kind] ?? 0) + 1;
}

/** Key of every row a previous batch traced, with the id it was written under. */
async function importedRefs(tx: Tx): Promise<Map<string, string>> {
  const rows = await tx.execute<{ key: string; id: string }>(sql`
    SELECT e.payload->>'key' AS key,
           COALESCE(o.person_id, o.supplier_id, o.lease_id, o.rent_term_id, o.expense_id,
                    o.loan_id, o.meter_id, o.fixed_asset_id)::text AS id
      FROM event e
      JOIN object_ref o ON o.id = e.primary_object_ref_id
     WHERE e.type = ${IMPORT_EVENT_TYPE} AND e.is_migration_import = true`);
  return new Map([...rows].map((row) => [row.key, row.id]));
}

function keyOf(record: SourceRecord): string {
  return `${record.source}:${record.kind}:${record.ref}`;
}

async function trace(
  tx: Tx,
  organizationId: string,
  batchId: string,
  kind: ObjectKind,
  id: string,
  record: SourceRecord,
  effectiveOn: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const objectRefId = await ensureObjectRef(tx, { organizationId, kind, id });
  await tx.insert(tables.event).values({
    organizationId,
    type: IMPORT_EVENT_TYPE,
    primaryObjectRefId: objectRefId,
    effectiveOn,
    occurredAt: new Date().toISOString(),
    origin: "import",
    actorLabel: "scripts/migrate",
    isMigrationImport: true,
    payload: {
      batchId,
      key: keyOf(record),
      source: record.source,
      ref: record.ref,
      kind: record.kind,
      ...extra,
    },
  });
}

function targetId(target: Target | undefined, created: Ids, what: string): string {
  if (!target) throw new ApplyRefused(`${what} : aucune résolution dans le plan`);
  if ("existingId" in target) return target.existingId;
  const id = created.get(target.create);
  if (!id) throw new ApplyRefused(`${what} : ${target.create} n’a pas été créé`);
  return id;
}

async function assertRowsExist(tx: Tx, table: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM ${sql.identifier(table)} WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`,
  );
  const found = new Set([...rows].map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ApplyRefused(
      `${table} : ${missing.length} ligne(s) du plan n’existent plus (${missing.slice(0, 3).join(", ")}) — relancez l’import à blanc`,
    );
  }
}

function existingIds(targets: Target[]): string[] {
  return [...new Set(targets.flatMap((t) => ("existingId" in t ? [t.existingId] : [])))];
}

async function writeOrganisationRows(
  tx: Tx,
  plan: Plan,
  batchId: string,
  imported: Map<string, string>,
  report: ApplyReport,
): Promise<Ids> {
  const created: Ids = new Map();
  const { organizationId } = plan;
  for (const [key, record] of Object.entries(plan.resolutions.personGroups)) {
    const previous = imported.get(keyOf(record));
    if (previous) {
      created.set(key, previous);
      report.alreadyImported += 1;
      continue;
    }
    const [person] = await tx
      .insert(tables.person)
      .values({
        organizationId,
        kind: "natural",
        displayName: record.displayName,
        odooPartnerId: record.odooPartnerId,
      })
      .returning({ id: tables.person.id });
    if (!person) throw new ApplyRefused(`person ${record.displayName} non créée`);
    created.set(key, person.id);
    for (const [kind, value] of [
      ["email", record.email],
      ["mobile", record.phone],
    ] as const) {
      if (value === null) continue;
      await tx.insert(tables.contactPoint).values({
        organizationId,
        personId: person.id,
        kind,
        value,
        isPrimary: true,
      });
    }
    await trace(tx, organizationId, batchId, "person", person.id, record, null);
    bump(report.written, "person");
  }
  for (const [key, record] of Object.entries(plan.resolutions.supplierGroups)) {
    const previous = imported.get(keyOf(record));
    if (previous) {
      created.set(key, previous);
      report.alreadyImported += 1;
      continue;
    }
    const [supplier] = await tx
      .insert(tables.supplier)
      .values({
        organizationId,
        name: record.name,
        odooPartnerId: record.odooPartnerId,
        status: "active",
      })
      .returning({ id: tables.supplier.id });
    if (!supplier) throw new ApplyRefused(`supplier ${record.name} non créé`);
    created.set(key, supplier.id);
    await trace(tx, organizationId, batchId, "supplier", supplier.id, record, null);
    bump(report.written, "supplier");
  }
  return created;
}

type EntityBatch = {
  entityId: string;
  leases: LeaseRecord[];
  rentTerms: RentTermRecord[];
  expenses: ExpenseRecord[];
  loans: LoanRecord[];
  meters: MeterRecord[];
  assets: AssetRecord[];
};

function entityKeyOf(record: SourceRecord): string | null {
  if (!("entity" in record)) return null;
  const odooId = "odooCompanyId" in record ? record.odooCompanyId : null;
  if (odooId !== null) return `odoo:${odooId}`;
  return record.entity.trim() === "" ? null : `name:${nameKey(record.entity)}`;
}

function batchesOf(plan: Plan): EntityBatch[] {
  const rejected = new Set(plan.rejections.map((r) => `${r.kind}:${r.ref}`));
  const deferred = new Set(plan.deferrals.map((d) => `${d.kind}:${d.ref}`));
  const byEntity = new Map<string, EntityBatch>();
  for (const record of plan.records) {
    const key = `${record.kind}:${record.ref}`;
    if (rejected.has(key) || deferred.has(key)) continue;
    const entityKey = entityKeyOf(record);
    const entityId = entityKey ? plan.resolutions.entities[entityKey] : undefined;
    if (!entityId) continue;
    let batch = byEntity.get(entityId);
    if (!batch) {
      batch = {
        entityId,
        leases: [],
        rentTerms: [],
        expenses: [],
        loans: [],
        meters: [],
        assets: [],
      };
      byEntity.set(entityId, batch);
    }
    switch (record.kind) {
      case "lease":
        if ("create" in (plan.resolutions.leases[record.ref] ?? {})) batch.leases.push(record);
        break;
      case "rent_term":
        batch.rentTerms.push(record);
        break;
      case "expense":
        batch.expenses.push(record);
        break;
      case "loan":
        batch.loans.push(record);
        break;
      case "meter":
        batch.meters.push(record);
        break;
      case "asset":
        batch.assets.push(record);
        break;
      default:
        break;
    }
  }
  return [...byEntity.values()];
}

async function writeEntityRows(
  tx: Tx,
  plan: Plan,
  batch: EntityBatch,
  batchId: string,
  orgIds: Ids,
  imported: Map<string, string>,
  report: ApplyReport,
  today: string,
): Promise<number> {
  const { organizationId } = plan;
  const { entityId } = batch;
  const readAt = new Date().toISOString();
  let written = 0;
  const created: Ids = new Map(orgIds);
  const skip = (record: SourceRecord, key?: string) => {
    const previous = imported.get(keyOf(record));
    if (!previous) return false;
    if (key) created.set(key, previous);
    report.alreadyImported += 1;
    return true;
  };

  for (const record of batch.leases) {
    if (skip(record, `lease:${record.reference}`)) continue;
    const tenantId = targetId(
      plan.resolutions.leaseTenants[record.ref],
      created,
      `bail ${record.reference}`,
    );
    const status = record.endsOn !== null && record.endsOn < today ? "terminated" : "active";
    const [lease] = await tx
      .insert(tables.lease)
      .values({
        organizationId,
        legalEntityId: entityId,
        reference: record.reference,
        kind: record.leaseKind,
        status,
        startsOn: record.startsOn,
        endsOn: record.endsOn,
        rentExclCharges: record.rent,
        chargeAmount: record.charges,
        chargeRegime: record.charges === "0.00" ? "none" : "provision",
        depositAmount: record.deposit,
        paymentDay: record.paymentDay,
      })
      .returning({ id: tables.lease.id });
    if (!lease) throw new ApplyRefused(`bail ${record.reference} non créé`);
    created.set(`lease:${record.reference}`, lease.id);
    await tx.insert(tables.leaseVersion).values({
      organizationId,
      leaseId: lease.id,
      sequence: 1,
      kind: "initial",
      effectiveOn: record.startsOn,
      rentExclCharges: record.rent,
      chargeAmount: record.charges,
      summary: record.inferred
        ? "Version déduite des loyers encaissés dans Odoo"
        : "Version reprise du tableau du propriétaire",
    });
    await tx.insert(tables.leaseParty).values({
      organizationId,
      leaseId: lease.id,
      personId: tenantId,
      role: "holder",
      startsOn: record.startsOn,
      endsOn: record.endsOn,
      isBillingContact: true,
    });
    if (record.deposit !== null && record.deposit !== "0.00") {
      await tx.insert(tables.depositAccount).values({
        organizationId,
        leaseId: lease.id,
        contractualAmount: record.deposit,
        status: "expected",
      });
    }
    await trace(tx, organizationId, batchId, "lease", lease.id, record, record.startsOn);
    bump(report.written, "lease");
    written += 1;
  }

  for (const record of batch.rentTerms) {
    if (skip(record)) continue;
    const leaseId = targetId(
      plan.resolutions.rentTermLeases[record.ref],
      created,
      record.odooMoveName,
    );
    const payerId = targetId(
      plan.resolutions.persons[`res.partner:${record.odooPartnerId}`],
      created,
      record.odooMoveName,
    );
    // TMP-04: history is flagged so the arrears job never turns an inherited
    // debt into a reminder the morning after the migration.
    const paid = money(record.total).minus(money(record.residual));
    const [term] = await tx
      .insert(tables.rentTerm)
      .values({
        organizationId,
        leaseId,
        kind: record.component === "rent" ? "rent" : "charge_provision",
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        dueOn: record.dueOn,
        status: record.settled ? "settled" : paid.isZero() ? "posted" : "partially_settled",
        postedAt: `${record.dueOn}T00:00:00.000Z`,
        ...(record.settled ? { settledAt: readAt } : {}),
        isMigrationImport: true,
      })
      .returning({ id: tables.rentTerm.id });
    if (!term) throw new ApplyRefused(`${record.odooMoveName} non créé`);
    const [version] = await tx
      .insert(tables.rentTermVersion)
      .values({
        organizationId,
        rentTermId: term.id,
        sequence: 1,
        rentAmount: record.component === "rent" ? record.total : "0.00",
        chargeAmount: record.component === "charges" ? record.total : "0.00",
        accessoryAmount: "0.00",
        totalAmount: record.total,
        reason: "initial",
        isPosted: true,
        odooMoveId: record.odooMoveId,
        odooMoveName: record.odooMoveName,
        odooReadAt: readAt,
      })
      .returning({ id: tables.rentTermVersion.id });
    if (!version) throw new ApplyRefused(`${record.odooMoveName} : version non créée`);
    await tx.execute(
      sql`UPDATE rent_term SET current_version_id = ${version.id}::uuid WHERE id = ${term.id}::uuid`,
    );
    // The invoice path knows one payment; the cash path knows every receipt of the month.
    const receipts =
      record.receipts.length > 0
        ? record.receipts
        : paid.isZero()
          ? []
          : [
              {
                ref: record.ref,
                amount: toMoney(paid),
                receivedOn: record.dueOn,
                odooMoveName: record.odooMoveName,
                odooStatementLineId: record.odooStatementLineId,
              },
            ];
    const paymentIds: string[] = [];
    for (const receipt of receipts) {
      const [payment] = await tx
        .insert(tables.payment)
        .values({
          organizationId,
          legalEntityId: entityId,
          direction: "inbound",
          amount: receipt.amount,
          receivedOn: receipt.receivedOn,
          payerPersonId: payerId,
          payerLabel: record.partnerName,
          status: "allocated",
          odooReadAt: readAt,
        })
        .returning({ id: tables.payment.id });
      if (!payment) throw new ApplyRefused(`${receipt.odooMoveName} : règlement non créé`);
      paymentIds.push(payment.id);
      await tx.insert(tables.paymentAllocation).values({
        organizationId,
        paymentId: payment.id,
        rentTermId: term.id,
        amount: receipt.amount,
        allocatedOn: receipt.receivedOn,
        confirmedByOdoo: true,
        odooReconcileRef: receipt.odooMoveName,
        odooReadAt: readAt,
      });
    }
    await trace(tx, organizationId, batchId, "rent_term", term.id, record, record.dueOn, {
      receivedOnAssumed: record.odooStatementLineId === null,
      odooStatementLineId: record.odooStatementLineId,
      nettedRefs: record.nettedRefs,
      paymentIds,
      receipts: receipts.map((receipt) => receipt.ref),
      residual: record.residual,
    });
    bump(report.written, "rent_term");
    written += 1;
  }

  for (const record of batch.expenses) {
    if (skip(record)) continue;
    const supplierId = targetId(
      plan.resolutions.suppliers[`res.partner:${record.odooPartnerId}`],
      created,
      record.odooMoveName,
    );
    const [expense] = await tx
      .insert(tables.expense)
      .values({
        organizationId,
        legalEntityId: entityId,
        supplierId,
        documentKind: "invoice",
        supplierReference: record.odooMoveName,
        issuedOn: record.issuedOn,
        totalInclTax: record.totalInclTax,
        sourceSystem: IMPORT_SOURCE_SYSTEM,
        sourceExternalId: record.ref,
        status: record.paid ? "paid" : "posted",
        odooMoveId: record.odooMoveId,
        odooMoveName: record.odooMoveName,
        odooReadAt: readAt,
      })
      .returning({ id: tables.expense.id });
    if (!expense) throw new ApplyRefused(`${record.odooMoveName} non créée`);
    await trace(tx, organizationId, batchId, "expense", expense.id, record, record.issuedOn);
    bump(report.written, "expense");
    written += 1;
  }

  for (const record of batch.loans) {
    if (skip(record)) continue;
    const [loan] = await tx
      .insert(tables.loan)
      .values({
        organizationId,
        legalEntityId: entityId,
        lenderName: record.lender,
        reference: record.reference,
        principalAmount: record.principal,
        releasedOn: record.releasedOn,
        durationMonths: record.durationMonths,
        nominalRate: record.nominalRate,
        status: "active",
      })
      .returning({ id: tables.loan.id });
    if (!loan) throw new ApplyRefused(`prêt ${record.reference} non créé`);
    if (record.outstanding !== null && record.outstandingOn !== null) {
      const [schedule] = await tx
        .insert(tables.loanScheduleVersion)
        .values({
          organizationId,
          loanId: loan.id,
          sequence: 1,
          reason: "initial",
          effectiveFrom: record.outstandingOn,
          source: "import",
        })
        .returning({ id: tables.loanScheduleVersion.id });
      if (!schedule) throw new ApplyRefused(`prêt ${record.reference} : échéancier non créé`);
      await tx.insert(tables.loanInstallment).values({
        organizationId,
        scheduleVersionId: schedule.id,
        installmentNumber: 0,
        dueOn: record.outstandingOn,
        totalAmount: "0.00",
        remainingPrincipal: record.outstanding,
        status: "matched",
        matchedAt: readAt,
        varianceReason: "capital restant dû repris du tableau du propriétaire",
      });
    }
    await trace(tx, organizationId, batchId, "loan", loan.id, record, record.releasedOn);
    bump(report.written, "loan");
    written += 1;
  }

  for (const record of batch.meters) {
    if (skip(record)) continue;
    const buildingId = plan.resolutions.buildings[record.ref];
    if (!buildingId)
      throw new ApplyRefused(`compteur ${record.serialNumber} : immeuble non résolu`);
    const [meter] = await tx
      .insert(tables.meter)
      .values({
        organizationId,
        buildingId,
        fluid: record.fluid,
        scope: record.scope,
        unitOfMeasure: record.unitOfMeasure,
        serialNumber: record.serialNumber,
        prmPdl: record.prm,
        pce: record.pce,
      })
      .returning({ id: tables.meter.id });
    if (!meter) throw new ApplyRefused(`compteur ${record.serialNumber} non créé`);
    if (record.lastIndex !== null && record.lastReadOn !== null) {
      await tx.insert(tables.meterReading).values({
        organizationId,
        meterId: meter.id,
        indexValue: record.lastIndex,
        readOn: record.lastReadOn,
        origin: "import",
        status: "recorded",
      });
    }
    await trace(tx, organizationId, batchId, "meter", meter.id, record, record.lastReadOn);
    bump(report.written, "meter");
    written += 1;
  }

  for (const record of batch.assets) {
    if (skip(record)) continue;
    const [asset] = await tx
      .insert(tables.fixedAsset)
      .values({
        organizationId,
        legalEntityId: entityId,
        label: record.label,
        grossValue: record.grossValue,
        accumulatedDepreciation: record.accumulatedDepreciation,
        netBookValue: record.netBookValue,
        commissionedOn: record.commissionedOn,
        odooAssetId: record.odooAssetId,
        odooReadAt: readAt,
        status: "running",
      })
      .returning({ id: tables.fixedAsset.id });
    if (!asset) throw new ApplyRefused(`immobilisation ${record.label} non créée`);
    await trace(
      tx,
      organizationId,
      batchId,
      "fixed_asset",
      asset.id,
      record,
      record.commissionedOn,
    );
    bump(report.written, "asset");
    written += 1;
  }
  return written;
}

/**
 * One tenant transaction for the organisation-level rows (persons, suppliers), then
 * one per legal entity. A plan with blockers is refused; rows already traced by a
 * previous batch are skipped, so a second run writes nothing twice.
 */
export async function applyPlan(
  db: DbHandle,
  plan: Plan,
  options: { today?: string } = {},
): Promise<ApplyReport> {
  if (plan.blockers.length > 0) {
    throw new ApplyRefused(`Plan bloqué : ${plan.blockers.join(" ; ")}`);
  }
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const batchId = newId();
  const report: ApplyReport = { batchId, written: {}, alreadyImported: 0, entities: [] };
  const context = { organizationId: plan.organizationId };

  const orgIds = await withTenant(db, context, async (tx) => {
    await assertRowsExist(tx, "legal_entity", [
      ...new Set(Object.values(plan.resolutions.entities)),
    ]);
    await assertRowsExist(tx, "person", existingIds(Object.values(plan.resolutions.persons)));
    await assertRowsExist(tx, "supplier", existingIds(Object.values(plan.resolutions.suppliers)));
    await assertRowsExist(tx, "lease", existingIds(Object.values(plan.resolutions.leases)));
    await assertRowsExist(tx, "building", [...new Set(Object.values(plan.resolutions.buildings))]);
    const imported = await importedRefs(tx);
    return writeOrganisationRows(tx, plan, batchId, imported, report);
  });

  for (const batch of batchesOf(plan)) {
    const written = await withTenant(db, context, async (tx) => {
      const imported = await importedRefs(tx);
      return writeEntityRows(tx, plan, batch, batchId, orgIds, imported, report, today);
    });
    const entity = plan.perEntity.find((e) => e.entityId === batch.entityId);
    report.entities.push({
      entityId: batch.entityId,
      entityName: entity?.entityName ?? batch.entityId,
      written,
    });
  }
  return report;
}
