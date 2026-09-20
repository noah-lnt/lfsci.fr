import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { type Tx, tables, withTenant } from "@lfsci/db";
import { money, toMoney } from "@lfsci/domain";
import { AppError, logger, newId } from "@lfsci/kernel";
import {
  buildDecompteData,
  buildRevisionData,
  compileTypst,
  type DecompteSource,
  type RevisionSource,
  type TemplateName,
} from "@lfsci/pdf";
import { documentKey, type Storage } from "@lfsci/storage";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.pdf.render");

export const PDF_TEMPLATES = ["quittance", "recu", "decompte", "revision"] as const;

/** Each template names the row it renders; a payload missing it can never succeed. */
const requiredIds = {
  quittance: ["rentReceiptId"],
  recu: ["rentReceiptId"],
  decompte: ["documentId", "regularizationRunId", "leaseId"],
  revision: ["documentId", "rentRevisionId"],
} as const;

export const PdfRenderData = JobBase.extend({
  organizationId: z.uuid(),
  rentReceiptId: z.uuid().optional(),
  documentId: z.uuid().optional(),
  regularizationRunId: z.uuid().optional(),
  leaseId: z.uuid().optional(),
  rentRevisionId: z.uuid().optional(),
  template: z.enum(PDF_TEMPLATES).default("quittance"),
}).superRefine((data, ctx) => {
  for (const key of requiredIds[data.template]) {
    if (data[key] === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [key],
        message: `${key} is required for the ${data.template} template`,
      });
    }
  }
});
export type PdfRenderData = z.infer<typeof PdfRenderData>;

/** The templates require a lot address and a place of issue; neither is nullable there. */
const DASH = "—";

const DECOMPTE_LABELS = {
  directKey: "Affectation directe",
  owes: "Solde restant dû",
  credit: "Trop-perçu à restituer",
  settled: "Compte soldé",
} as const;

const FROZEN_EVENT = "regularization.frozen";

function amount(value: string): string {
  return toMoney(money(value));
}

function requireId(value: string | undefined, key: string): string {
  if (value === undefined) throw new AppError("VALIDATION", { details: { key } });
  return value;
}

/** One French postal line; `undefined` when the address was never filled in. */
function postalAddress(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  postalCode: string | null;
  city: string | null;
}): string | undefined {
  const locality = [input.postalCode, input.city].filter(Boolean).join(" ");
  const parts = [input.addressLine1, input.addressLine2, locality].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

type LegalEntityRow = typeof tables.legalEntity.$inferSelect;

/**
 * `adresse` and `siret` are omitted rather than dashed: `common.typ` prints each
 * only when the key is there, and the schema marks both optional.
 */
function sciParty(entity: LegalEntityRow | undefined) {
  const adresse = entity ? postalAddress(entity) : undefined;
  return {
    nom: entity?.name ?? "SCI",
    ...(adresse ? { adresse } : {}),
    ...(entity?.siren ? { siret: entity.siren } : {}),
  };
}

type UnitAddress = { designation: string; adresse: string; city: string };

async function unitAddress(tx: Tx, unitId: string): Promise<UnitAddress | undefined> {
  const rows = await tx
    .select({
      code: tables.unit.code,
      label: tables.unit.label,
      addressLine1: tables.building.addressLine1,
      postalCode: tables.building.postalCode,
      city: tables.building.city,
    })
    .from(tables.unit)
    .innerJoin(tables.building, eq(tables.building.id, tables.unit.buildingId))
    .where(eq(tables.unit.id, unitId))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return {
    designation: `${row.code} — ${row.label}`,
    adresse: postalAddress(row) ?? DASH,
    city: row.city ?? DASH,
  };
}

async function holderName(tx: Tx, leaseId: string): Promise<string | undefined> {
  const rows = await tx
    .select({ displayName: tables.person.displayName })
    .from(tables.leaseParty)
    .innerJoin(tables.person, eq(tables.person.id, tables.leaseParty.personId))
    .where(
      and(
        eq(tables.leaseParty.leaseId, leaseId),
        inArray(tables.leaseParty.role, ["holder", "co_holder"]),
      ),
    )
    .orderBy(sql`is_billing_contact DESC`, asc(tables.leaseParty.startsOn))
    .limit(1);
  return rows[0]?.displayName;
}

type Rendered = {
  documentId: string;
  filename: string;
  pdf: Uint8Array;
  /** Set only when nothing upstream created the `document` row. */
  document?: { title: string; nature: string };
  after?: (tx: Tx, documentId: string) => Promise<void>;
};

async function renderReceiptPdf(deps: Deps, data: PdfRenderData): Promise<Rendered> {
  const { organizationId } = data;
  const rentReceiptId = requireId(data.rentReceiptId, "rentReceiptId");

  const context = await withTenant(deps.db, { organizationId }, async (tx) => {
    const receipts = await tx
      .select()
      .from(tables.rentReceipt)
      .where(eq(tables.rentReceipt.id, rentReceiptId))
      .limit(1);
    const receipt = receipts[0];
    if (!receipt) return null;
    const leases = await tx
      .select()
      .from(tables.lease)
      .where(eq(tables.lease.id, receipt.leaseId))
      .limit(1);
    const entities = await tx
      .select()
      .from(tables.legalEntity)
      .where(eq(tables.legalEntity.id, leases[0]?.legalEntityId ?? ""))
      .limit(1);
    return { receipt, lease: leases[0], entity: entities[0] };
  });
  if (!context) throw new AppError("NOT_FOUND", { details: { rentReceiptId } });

  const { receipt, lease, entity } = context;
  const base = {
    sci: sciParty(entity),
    locataire: { nom: lease?.reference ?? "Locataire" },
    lot: { designation: lease?.reference ?? "Lot", adresse: DASH },
    periode: { debut: receipt.periodStart, fin: receipt.periodEnd },
    lieu: entity?.city ?? DASH,
    dateEdition: receipt.issuedOn,
    signataire: entity?.name ?? "SCI",
  };

  const pdf =
    data.template === "quittance"
      ? await compileTypst({
          template: "quittance" satisfies TemplateName,
          tmpDir: tmpdir(),
          ...(deps.env.TYPST_BINARY ? { typstBinary: deps.env.TYPST_BINARY } : {}),
          data: {
            ...base,
            loyer: amount(receipt.rentAmount),
            provisions: amount(receipt.chargeAmount),
            total: amount(receipt.totalAmount),
            datePaiement: receipt.issuedOn,
          },
        })
      : await compileTypst({
          template: "recu" satisfies TemplateName,
          tmpDir: tmpdir(),
          ...(deps.env.TYPST_BINARY ? { typstBinary: deps.env.TYPST_BINARY } : {}),
          data: {
            ...base,
            total: amount(receipt.totalAmount),
            montantRecu: amount(receipt.totalAmount),
            resteDu: "0.00",
            datePaiement: receipt.issuedOn,
            modePaiement: DASH,
          },
        });

  const documentId = receipt.documentId ?? newId();
  const filename = `${data.template}-${receipt.periodStart}.pdf`;
  return {
    documentId,
    filename,
    pdf,
    ...(receipt.documentId
      ? {}
      : { document: { title: filename, nature: "rent_receipt" as const } }),
    after: async (tx, id) => {
      await tx
        .update(tables.rentReceipt)
        .set({ documentId: id, updatedAt: new Date().toISOString() })
        .where(eq(tables.rentReceipt.id, receipt.id));
    },
  };
}

const FrozenPosting = z.object({
  label: z.string(),
  recoverableAmount: z.string(),
  keyLabel: z.string().nullish(),
  lots: z.array(
    z.object({ tenants: z.array(z.object({ leaseId: z.string(), amount: z.string() })) }),
  ),
});

const FrozenLine = z.object({
  leaseId: z.string(),
  tenantName: z.string(),
  unitId: z.string(),
  unitLabel: z.string(),
  occupancyDays: z.number().int(),
  periodDays: z.number().int(),
  recoverableAmount: z.string(),
  provisionsCalled: z.string(),
  provisionsPaid: z.string(),
  provisionsUnpaid: z.string(),
  balanceAmount: z.string(),
});

const FrozenSnapshot = z.object({
  runId: z.string(),
  postings: z.array(FrozenPosting),
  lines: z.array(FrozenLine),
});

/**
 * CHA-02: the statement is rendered from what the freeze wrote, never recomputed
 * here — a later change to an expense must not move a published statement.
 */
export async function decompteSource(deps: Deps, data: PdfRenderData): Promise<DecompteSource> {
  const { organizationId } = data;
  const runId = requireId(data.regularizationRunId, "regularizationRunId");
  const leaseId = requireId(data.leaseId, "leaseId");

  return withTenant(deps.db, { organizationId }, async (tx) => {
    const runs = await tx
      .select()
      .from(tables.provisionRegularizationRun)
      .where(eq(tables.provisionRegularizationRun.id, runId))
      .limit(1);
    const run = runs[0];
    if (!run) throw new AppError("NOT_FOUND", { details: { regularizationRunId: runId } });

    const events = await tx
      .select({ payload: tables.event.payload })
      .from(tables.event)
      .where(
        and(
          eq(tables.event.type, FROZEN_EVENT),
          sql`${tables.event.payload} ->> 'runId' = ${runId}`,
        ),
      )
      .orderBy(desc(tables.event.occurredAt))
      .limit(1);
    const parsed = FrozenSnapshot.safeParse(events[0]?.payload);
    if (!parsed.success) {
      throw new AppError("RULE_VIOLATION", {
        message: "régularisation non gelée : aucun décompte ne peut être édité",
        details: { regularizationRunId: runId },
      });
    }
    const snapshot = parsed.data;

    const line = snapshot.lines.find((row) => row.leaseId === leaseId);
    if (!line) throw new AppError("NOT_FOUND", { details: { runId, leaseId } });

    const postings = snapshot.postings
      .map((posting) => ({
        label: posting.label,
        recoverableAmount: amount(posting.recoverableAmount),
        keyLabel: posting.keyLabel ?? null,
        quotePart: sumForLease(posting, leaseId),
      }))
      .filter((posting) => posting.quotePart !== "0.00");
    if (postings.length === 0) {
      throw new AppError("RULE_VIOLATION", {
        message: "aucune charge récupérable pour ce bail sur la période",
        details: { runId, leaseId },
      });
    }

    const entities = await tx
      .select()
      .from(tables.legalEntity)
      .where(eq(tables.legalEntity.id, run.legalEntityId))
      .limit(1);
    const entity = entities[0];
    const unit = await unitAddress(tx, line.unitId);

    const occupancies = await tx
      .select({ startsOn: tables.leaseUnit.startsOn, endsOn: tables.leaseUnit.endsOn })
      .from(tables.leaseUnit)
      .where(and(eq(tables.leaseUnit.leaseId, leaseId), eq(tables.leaseUnit.unitId, line.unitId)));
    const starts = occupancies.map((row) =>
      row.startsOn < run.periodStart ? run.periodStart : row.startsOn,
    );
    const ends = occupancies.map((row) =>
      row.endsOn === null || row.endsOn > run.periodEnd ? run.periodEnd : row.endsOn,
    );

    return {
      sci: sciParty(entity),
      locataire: { nom: line.tenantName },
      lot: {
        designation: unit?.designation ?? line.unitLabel,
        adresse: unit?.adresse ?? DASH,
      },
      lieu: entity?.city ?? unit?.city ?? DASH,
      signataire: entity?.name ?? "SCI",
      issuedOn: deps.now().toISOString().slice(0, 10),
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      occupancyStart: starts.sort().at(0) ?? run.periodStart,
      occupancyEnd: ends.sort().at(-1) ?? run.periodEnd,
      occupancyDays: line.occupancyDays,
      periodDays: line.periodDays,
      postings,
      totalCharges: amount(line.recoverableAmount),
      provisionsAppelees: amount(line.provisionsCalled),
      provisionsPayees: amount(line.provisionsPaid),
      provisionsImpayees: amount(line.provisionsUnpaid),
      balance: amount(line.balanceAmount),
      labels: DECOMPTE_LABELS,
    };
  });
}

function sumForLease(posting: z.infer<typeof FrozenPosting>, leaseId: string): string {
  return toMoney(
    posting.lots
      .flatMap((lot) => lot.tenants)
      .filter((tenant) => tenant.leaseId === leaseId)
      .reduce((total, tenant) => total.plus(money(tenant.amount)), money("0")),
  );
}

/** IRL-01: the letter carries the exact index values the revision was computed with. */
export async function revisionSource(deps: Deps, data: PdfRenderData): Promise<RevisionSource> {
  const { organizationId } = data;
  const rentRevisionId = requireId(data.rentRevisionId, "rentRevisionId");

  return withTenant(deps.db, { organizationId }, async (tx) => {
    const revisions = await tx
      .select()
      .from(tables.rentRevision)
      .where(eq(tables.rentRevision.id, rentRevisionId))
      .limit(1);
    const revision = revisions[0];
    if (!revision) throw new AppError("NOT_FOUND", { details: { rentRevisionId } });
    if (!revision.effectiveOn) {
      throw new AppError("RULE_VIOLATION", {
        message: "révision sans date d’effet : la notification ne peut être éditée",
        details: { rentRevisionId },
      });
    }

    const leases = await tx
      .select()
      .from(tables.lease)
      .where(eq(tables.lease.id, revision.leaseId))
      .limit(1);
    const lease = leases[0];
    if (!lease) throw new AppError("NOT_FOUND", { details: { leaseId: revision.leaseId } });

    const entities = await tx
      .select()
      .from(tables.legalEntity)
      .where(eq(tables.legalEntity.id, lease.legalEntityId))
      .limit(1);
    const entity = entities[0];

    const mainUnits = await tx
      .select({ unitId: tables.leaseUnit.unitId })
      .from(tables.leaseUnit)
      .where(and(eq(tables.leaseUnit.leaseId, lease.id), eq(tables.leaseUnit.role, "main")))
      .limit(1);
    const unitId = mainUnits[0]?.unitId;
    const unit = unitId ? await unitAddress(tx, unitId) : undefined;
    const indexLabel = revision.indexName.toUpperCase();

    return {
      sci: sciParty(entity),
      locataire: { nom: (await holderName(tx, lease.id)) ?? lease.reference },
      lot: { designation: unit?.designation ?? lease.reference, adresse: unit?.adresse ?? DASH },
      lieu: entity?.city ?? unit?.city ?? DASH,
      signataire: entity?.name ?? "SCI",
      issuedOn: deps.now().toISOString().slice(0, 10),
      periodStart: revision.effectiveOn,
      periodEnd: lease.endsOn ?? revision.effectiveOn,
      indexLabel,
      referenceQuarter: revision.referenceQuarter,
      previousIndexValue: revision.previousIndexValue,
      newIndexValue: revision.newIndexValue,
      baseRent: amount(revision.baseRent),
      proposedRent: amount(revision.proposedRent),
      computedRentUnrounded: revision.computedRentUnrounded,
      variation: toMoney(
        money(amount(revision.proposedRent)).minus(money(amount(revision.baseRent))),
      ),
      chargeAmount: amount(lease.chargeAmount ?? "0"),
      effectiveOn: revision.effectiveOn,
      clause: `indice ${indexLabel}, trimestre de référence ${revision.referenceQuarter}`,
      source: "l’INSEE",
    };
  });
}

async function compile(deps: Deps, data: PdfRenderData): Promise<Rendered> {
  const documentId = requireId(data.documentId, "documentId");
  const typst = deps.env.TYPST_BINARY ? { typstBinary: deps.env.TYPST_BINARY } : {};

  if (data.template === "decompte") {
    const source = await decompteSource(deps, data);
    return {
      documentId,
      filename: `decompte-${source.periodStart}.pdf`,
      pdf: await compileTypst({
        template: "decompte" satisfies TemplateName,
        tmpDir: tmpdir(),
        ...typst,
        data: buildDecompteData(source),
      }),
    };
  }

  const source = await revisionSource(deps, data);
  return {
    documentId,
    filename: `revision-${source.effectiveOn}.pdf`,
    pdf: await compileTypst({
      template: "revision" satisfies TemplateName,
      tmpDir: tmpdir(),
      ...typst,
      data: buildRevisionData(source),
    }),
  };
}

async function store(
  deps: Deps,
  storage: Storage,
  organizationId: string,
  rendered: Rendered,
): Promise<string> {
  const { documentId, filename, pdf } = rendered;
  const key = documentKey({ organizationId, documentId, version: 1, filename });
  const upload = await storage.presignUpload({
    key,
    contentType: "application/pdf",
    contentLength: pdf.byteLength,
  });
  const response = await fetch(upload.url, {
    method: "PUT",
    headers: upload.headers,
    body: pdf,
  });
  if (!response.ok) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      message: "pdf upload failed",
      details: { status: response.status },
    });
  }

  return withTenant(deps.db, { organizationId }, async (tx) => {
    if (rendered.document) {
      await tx.insert(tables.document).values({
        id: documentId,
        organizationId,
        title: rendered.document.title,
        nature: rendered.document.nature,
      });
    }
    const sequences = await tx
      .select({ sequence: tables.documentVersion.sequence })
      .from(tables.documentVersion)
      .where(eq(tables.documentVersion.documentId, documentId));
    const next = sequences.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
    const rows = await tx
      .insert(tables.documentVersion)
      .values({
        organizationId,
        documentId,
        sequence: next,
        // `document_version.role` has no "generated" value: the rendered PDF is
        // the document's own file, so it is the original.
        role: "original",
        storageKey: key,
        contentType: "application/pdf",
        byteSize: pdf.byteLength,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        detectedType: "application/pdf",
      })
      .returning({ id: tables.documentVersion.id });
    const row = rows[0];
    if (!row) throw new AppError("CONFLICT", { message: "document_version insert returned none" });
    await tx
      .update(tables.document)
      .set({ currentVersionId: row.id, status: "active", updatedAt: new Date().toISOString() })
      .where(eq(tables.document.id, documentId));
    await rendered.after?.(tx, documentId);
    return row.id;
  });
}

export async function renderPdf(deps: Deps, data: PdfRenderData): Promise<JobOutcome> {
  if (!deps.storage) return { outcome: "sources_unavailable", missing: ["storage"] };

  const rendered =
    data.template === "decompte" || data.template === "revision"
      ? await compile(deps, data)
      : await renderReceiptPdf(deps, data);
  const documentVersionId = await store(deps, deps.storage, data.organizationId, rendered);

  log.info(
    { template: data.template, documentVersionId, bytes: rendered.pdf.byteLength },
    "document rendered",
  );
  return {
    outcome: "rendered",
    template: data.template,
    documentId: rendered.documentId,
    documentVersionId,
    bytes: rendered.pdf.byteLength,
  };
}

export const pdfRender = defineJob({
  name: "pdf.render",
  schema: PdfRenderData,
  options: {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 300,
    localConcurrency: 1,
  },
  handler: (data, deps) => renderPdf(deps, data),
});
