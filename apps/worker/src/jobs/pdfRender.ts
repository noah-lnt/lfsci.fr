import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { tables, withTenant } from "@lfsci/db";
import { AppError, logger, newId } from "@lfsci/kernel";
import { compileTypst, type TemplateName } from "@lfsci/pdf";
import { documentKey } from "@lfsci/storage";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.pdf.render");

export const PdfRenderData = JobBase.extend({
  organizationId: z.uuid(),
  rentReceiptId: z.uuid(),
  template: z.enum(["quittance", "recu", "decompte"]).default("quittance"),
});
export type PdfRenderData = z.infer<typeof PdfRenderData>;

function amount(value: string): string {
  return Number(value).toFixed(2);
}

export async function renderReceipt(deps: Deps, data: PdfRenderData): Promise<JobOutcome> {
  if (!deps.storage) return { outcome: "sources_unavailable", missing: ["storage"] };
  const storage = deps.storage;
  const { organizationId } = data;

  const context = await withTenant(deps.db, { organizationId }, async (tx) => {
    const receipts = await tx
      .select()
      .from(tables.rentReceipt)
      .where(eq(tables.rentReceipt.id, data.rentReceiptId))
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
  if (!context) throw new AppError("NOT_FOUND", { details: { rentReceiptId: data.rentReceiptId } });

  const { receipt, lease, entity } = context;
  const base = {
    sci: { nom: entity?.name ?? "SCI", ...(entity?.siren ? { siret: entity.siren } : {}) },
    locataire: { nom: lease?.reference ?? "Locataire" },
    lot: { designation: lease?.reference ?? "Lot", adresse: "—" },
    periode: { debut: receipt.periodStart, fin: receipt.periodEnd },
    lieu: "—",
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
            modePaiement: "—",
          },
        });

  const documentId = receipt.documentId ?? newId();
  const filename = `${data.template}-${receipt.periodStart}.pdf`;
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

  const documentVersionId = await withTenant(deps.db, { organizationId }, async (tx) => {
    if (!receipt.documentId) {
      await tx.insert(tables.document).values({
        id: documentId,
        organizationId,
        title: filename,
        nature: "rent_receipt",
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
        role: "generated",
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
      .set({ currentVersionId: row.id })
      .where(eq(tables.document.id, documentId));
    await tx
      .update(tables.rentReceipt)
      .set({ documentId, updatedAt: new Date().toISOString() })
      .where(eq(tables.rentReceipt.id, receipt.id));
    return row.id;
  });

  log.info({ documentVersionId, bytes: pdf.byteLength }, "receipt rendered");
  return { outcome: "rendered", documentId, documentVersionId, bytes: pdf.byteLength };
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
  handler: (data, deps) => renderReceipt(deps, data),
});
