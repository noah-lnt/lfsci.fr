import "server-only";
import type { DocumentEntity, ObjectRef } from "@lfsci/contracts";
import { ensureObjectRef, recordAudit, type Tx, tables } from "@lfsci/db";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or } from "drizzle-orm";
import type { LinkDocumentInput } from "@/lib/contracts/documents";
import { decodeCursor, encodeCursor, objectRefFromRow, page, requireRow } from "../patrimoine/rows";
import { objectRefId } from "../patrimoine/timeline";
import { type DocumentLinkView, toDocument } from "./rows";

export type Scope = { organizationId: string; actorId: string };

type DocumentRow = typeof tables.document.$inferSelect;
type VersionRow = typeof tables.documentVersion.$inferSelect;

async function versionsOf(tx: Tx, ids: string[]): Promise<Map<string, VersionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(tables.documentVersion)
    .where(inArray(tables.documentVersion.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

async function linksOf(tx: Tx, documentIds: string[]): Promise<Map<string, DocumentLinkView[]>> {
  const grouped = new Map<string, DocumentLinkView[]>();
  if (documentIds.length === 0) return grouped;
  const rows = await tx
    .select({
      documentId: tables.documentLink.documentId,
      relation: tables.documentLink.relation,
      ref: tables.objectRef,
    })
    .from(tables.documentLink)
    .innerJoin(tables.objectRef, eq(tables.objectRef.id, tables.documentLink.objectRefId))
    .where(inArray(tables.documentLink.documentId, documentIds));
  for (const row of rows) {
    const list = grouped.get(row.documentId) ?? [];
    list.push({
      relation: row.relation as DocumentLinkView["relation"],
      object: objectRefFromRow(row.ref),
    });
    grouped.set(row.documentId, list);
  }
  return grouped;
}

async function hydrate(tx: Tx, rows: DocumentRow[]): Promise<DocumentEntity[]> {
  const versions = await versionsOf(
    tx,
    rows.map((row) => row.currentVersionId).filter((id): id is string => id !== null),
  );
  const links = await linksOf(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    toDocument(
      row,
      row.currentVersionId ? (versions.get(row.currentVersionId) ?? null) : null,
      links.get(row.id) ?? [],
    ),
  );
}

export async function getDocument(tx: Tx, id: string): Promise<DocumentEntity> {
  const rows = await tx.select().from(tables.document).where(eq(tables.document.id, id));
  const row = requireRow(rows[0], "document");
  const [entity] = await hydrate(tx, [row]);
  return requireRow(entity, "document");
}

export async function getDocumentRow(tx: Tx, id: string): Promise<DocumentRow> {
  const rows = await tx.select().from(tables.document).where(eq(tables.document.id, id));
  return requireRow(rows[0], "document");
}

export type ListDocumentsArgs = {
  cursor?: string | undefined;
  limit: number;
  nature?: string | undefined;
  status?: string | undefined;
  search?: string | undefined;
  object?: ObjectRef | undefined;
  periodFrom?: string | undefined;
  periodTo?: string | undefined;
};

/** DOC-01: filtered by object, nature and period; never by joining the stored bytes. */
export async function listDocuments(tx: Tx, args: ListDocumentsArgs) {
  const cursor = args.cursor ? decodeCursor(args.cursor) : null;
  const where = and(
    args.nature ? eq(tables.document.nature, args.nature) : undefined,
    args.status ? eq(tables.document.status, args.status) : undefined,
    args.search ? ilike(tables.document.title, `%${args.search}%`) : undefined,
    args.periodFrom
      ? or(
          gte(tables.document.periodStart, args.periodFrom),
          gte(tables.document.periodEnd, args.periodFrom),
        )
      : undefined,
    args.periodTo ? lte(tables.document.periodStart, args.periodTo) : undefined,
    cursor
      ? or(
          lt(tables.document.createdAt, cursor.at),
          and(eq(tables.document.createdAt, cursor.at), lt(tables.document.id, cursor.id)),
        )
      : undefined,
  );

  const objectRef = args.object ? await objectRefId(tx, args.object) : null;
  if (args.object && !objectRef) return { items: [], nextCursor: null };

  const rows = objectRef
    ? await tx
        .selectDistinct({ document: tables.document })
        .from(tables.document)
        .innerJoin(tables.documentLink, eq(tables.documentLink.documentId, tables.document.id))
        .where(and(where, eq(tables.documentLink.objectRefId, objectRef)))
        .orderBy(desc(tables.document.createdAt), desc(tables.document.id))
        .limit(args.limit + 1)
        .then((joined) => joined.map((row) => row.document))
    : await tx
        .select()
        .from(tables.document)
        .where(where)
        .orderBy(desc(tables.document.createdAt), desc(tables.document.id))
        .limit(args.limit + 1);

  const result = page(rows, args.limit, (row) => encodeCursor(row.createdAt, row.id));
  return { items: await hydrate(tx, result.items), nextCursor: result.nextCursor };
}

/** DOC-01: one stored original, several objects pointing at it. */
export async function linkDocument(
  tx: Tx,
  scope: Scope,
  input: LinkDocumentInput,
): Promise<DocumentEntity> {
  await getDocumentRow(tx, input.documentId);
  const objectRefId = await ensureObjectRef(tx, {
    organizationId: scope.organizationId,
    kind: input.object.kind,
    id: input.object.id,
  });
  await tx
    .insert(tables.documentLink)
    .values({
      organizationId: scope.organizationId,
      documentId: input.documentId,
      objectRefId,
      relation: input.relation,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    .onConflictDoNothing();
  await recordAudit(tx, {
    organizationId: scope.organizationId,
    actorKind: "user",
    actorUserId: scope.actorId,
    objectTable: "document_link",
    objectId: input.documentId,
    action: "link",
    afterValue: { object: input.object, relation: input.relation },
  });
  return getDocument(tx, input.documentId);
}
