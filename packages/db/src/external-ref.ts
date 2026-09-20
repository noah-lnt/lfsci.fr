import { AppError } from "@lfsci/kernel";
import { and, eq } from "drizzle-orm";
import type { Tx } from "./client";
import { externalRef } from "./generated/schema";

export type ExternalRefRow = typeof externalRef.$inferSelect;

export type MapExternalInput = {
  organizationId: string;
  model: string;
  externalId: string | number;
  internalId: string;
  internalTable: string;
  odooDatabase: string;
  /** Odoo res.company id of the record. */
  company?: number | null;
  system?: ExternalRefRow["system"];
  objectRefId?: string | null;
};

/**
 * MOD-02: one external identity maps to at most one internal object, and one
 * internal object holds at most one external identity per model. A second
 * mapping is a data-integrity conflict, never an overwrite.
 */
export async function mapExternal(tx: Tx, input: MapExternalInput): Promise<ExternalRefRow> {
  const externalId = String(input.externalId);
  const byExternal = await findByExternal(tx, { ...input, externalId });
  const byInternal = await findByInternal(tx, input);

  if (byExternal && byInternal && byExternal.id === byInternal.id) {
    return touch(tx, byExternal.id);
  }
  if (byExternal) {
    throw new AppError("CONFLICT", {
      message: "external identity already maps to another internal object",
      details: {
        model: input.model,
        externalId,
        mappedInternalId: byExternal.internalId,
        submittedInternalId: input.internalId,
      },
    });
  }
  if (byInternal) {
    throw new AppError("CONFLICT", {
      message: "internal object already maps to another external identity",
      details: {
        model: input.model,
        internalId: input.internalId,
        mappedExternalId: byInternal.externalId,
        submittedExternalId: externalId,
      },
    });
  }

  const rows = await tx
    .insert(externalRef)
    .values({
      organizationId: input.organizationId,
      system: input.system ?? "odoo",
      odooDatabase: input.odooDatabase,
      odooCompanyId: input.company ?? null,
      model: input.model,
      externalId,
      internalId: input.internalId,
      internalTable: input.internalTable,
      objectRefId: input.objectRefId ?? null,
      lastReadAt: new Date().toISOString(),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new AppError("CONFLICT", { message: "external_ref insert returned no row" });
  return row;
}

export async function findByExternal(
  tx: Tx,
  key: { organizationId: string; odooDatabase: string; model: string; externalId: string | number },
): Promise<ExternalRefRow | undefined> {
  const rows = await tx
    .select()
    .from(externalRef)
    .where(
      and(
        eq(externalRef.organizationId, key.organizationId),
        eq(externalRef.odooDatabase, key.odooDatabase),
        eq(externalRef.model, key.model),
        eq(externalRef.externalId, String(key.externalId)),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findByInternal(
  tx: Tx,
  key: { organizationId: string; model: string; internalId: string },
): Promise<ExternalRefRow | undefined> {
  const rows = await tx
    .select()
    .from(externalRef)
    .where(
      and(
        eq(externalRef.organizationId, key.organizationId),
        eq(externalRef.model, key.model),
        eq(externalRef.internalId, key.internalId),
      ),
    )
    .limit(1);
  return rows[0];
}

async function touch(tx: Tx, id: string): Promise<ExternalRefRow> {
  const rows = await tx
    .update(externalRef)
    .set({ lastReadAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(eq(externalRef.id, id))
    .returning();
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { externalRefId: id } });
  return row;
}
