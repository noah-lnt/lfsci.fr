import "server-only";
import type {
  ActionRequiredResult,
  AmountExplanationResult,
  AssistantPorts,
  MemorySearchResult,
  ObjectSummaryResult,
  PreparedCommand,
  ToolSource,
} from "@lfsci/ai";
import { CommandType, resolveDecisionLevel } from "@lfsci/contracts";
import type { ObjectKind, Tx } from "@lfsci/db";
import { createCommand, ensureObjectRef } from "@lfsci/db";
import { AppError, newId } from "@lfsci/kernel";
import { sql } from "drizzle-orm";
import { buildCards } from "../accueil/cards";
import { loadCardSource, loadSituation } from "../accueil/query";
import type { TenantScope } from "../accueil/scope";
import { tenant } from "../data";
import type { WireSource } from "./sse";

const OBJECT_ID = sql`COALESCE(o.legal_entity_id, o.building_id, o.unit_id, o.person_id, o.lease_id,
  o.rent_term_id, o.payment_id, o.deposit_account_id, o.expense_id, o.works_project_id,
  o.intervention_id, o.equipment_id, o.meter_id, o.loan_id, o.partner_current_account_id,
  o.fixed_asset_id, o.insurance_policy_id, o.claim_id, o.booking_id, o.listing_id,
  o.inspection_id, o.supplier_id, o.bank_account_id, o.document_id)`;

function isObjectKind(value: string): value is ObjectKind {
  return /^[a-z_]+$/.test(value);
}

async function objectRefId(tx: Tx, kind: string, id: string): Promise<string | null> {
  const rows = [
    ...(await tx.execute<{ id: string }>(
      sql`SELECT o.id FROM object_ref o WHERE o.kind = ${kind} AND ${OBJECT_ID} = ${id}::uuid LIMIT 1`,
    )),
  ];
  return rows[0]?.id ?? null;
}

export type PortCollector = {
  ports: AssistantPorts;
  /** Drains the sources gathered by the tools, for the `tool_result` and `done` frames. */
  takeSources(): WireSource[];
  proposedCommandId(): string | null;
};

/**
 * MEM-01: every query runs inside the caller's tenant transaction, so RLS has
 * already applied the rights before a single row reaches the model.
 */
export function createAssistantPorts(scope: TenantScope): PortCollector {
  let sources: WireSource[] = [];
  let lastCommandId: string | null = null;

  const record = (entries: WireSource[]): void => {
    sources = [...sources, ...entries];
  };

  const ports: AssistantPorts = {
    async getActionRequired(): Promise<ActionRequiredResult> {
      const [source, situation] = await Promise.all([loadCardSource(scope), loadSituation(scope)]);
      const cards = buildCards(source);
      record(
        cards.flatMap((card) =>
          card.objectRefs.map((object) => ({
            label: card.why,
            object,
            freshnessAt: card.occurredAt,
          })),
        ),
      );
      return {
        items: cards.map((card) => ({
          id: card.id,
          label: card.why,
          dueOn: card.occurredAt.slice(0, 10),
        })),
        controlsComplete: situation.banner.controls === "complete",
        unavailableSources: situation.banner.controls === "complete" ? [] : situation.banner.failed,
        sources: cards.map(
          (card): ToolSource => ({ id: card.id, kind: card.kind, asOf: card.occurredAt }),
        ),
      };
    },

    async summarizeObject(input): Promise<ObjectSummaryResult> {
      return tenant(scope, async (tx) => {
        const refId = await objectRefId(tx, input.objectType, input.objectId);
        if (!refId) throw new AppError("NOT_FOUND", { details: { object: input.objectType } });

        const facts = [
          ...(await tx.execute<{ id: string; kind: string; label: string; as_of: string }>(sql`
            SELECT e.id, 'event' AS kind, e.type AS label,
                   to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS as_of
              FROM event e JOIN event_link el ON el.event_id = e.id
             WHERE el.object_ref_id = ${refId}::uuid
             UNION ALL
            SELECT a.id, 'activity', COALESCE(a.subject, a.channel),
                   to_char(a.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00')
              FROM activity a JOIN activity_link al ON al.activity_id = a.id
             WHERE al.object_ref_id = ${refId}::uuid
             UNION ALL
            SELECT d.id, 'document', d.title,
                   to_char(d.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00')
              FROM document d JOIN document_link dl ON dl.document_id = d.id
             WHERE dl.object_ref_id = ${refId}::uuid
             ORDER BY as_of DESC
             LIMIT 40`)),
        ];

        record(
          facts.map((fact) => ({
            label: `${fact.kind} — ${fact.label}`,
            object: { kind: input.objectType, id: input.objectId } as WireSource["object"],
            freshnessAt: fact.as_of,
          })),
        );

        const lines = facts.map(
          (fact) => `${fact.as_of.slice(0, 10)} · ${fact.kind} · ${fact.label} (${fact.id})`,
        );
        return {
          summary:
            lines.length > 0
              ? lines.join("\n")
              : "Aucun fait enregistré sur cet objet pour l’instant.",
          sources: facts.map(
            (fact): ToolSource => ({ id: fact.id, kind: fact.kind, asOf: fact.as_of }),
          ),
        };
      });
    },

    async searchMemory(input): Promise<MemorySearchResult> {
      return tenant(scope, async (tx) => {
        const rows = [
          ...(await tx.execute<{
            id: string;
            kind: string;
            object_id: string;
            excerpt: string;
            as_of: string;
          }>(sql`
            SELECT s.source_id AS id, o.kind, ${OBJECT_ID} AS object_id,
                   ts_headline('french', COALESCE(s.title, '') || ' ' || COALESCE(s.body, ''),
                               plainto_tsquery('french', unaccent(${input.query})),
                               'MaxWords=30, MinWords=10, ShortWord=2') AS excerpt,
                   to_char(s.indexed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF:00') AS as_of
              FROM search_document s JOIN object_ref o ON o.id = s.object_ref_id
             WHERE s.tsv @@ plainto_tsquery('french', unaccent(${input.query}))
             ORDER BY ts_rank(s.tsv, plainto_tsquery('french', unaccent(${input.query}))) DESC
             LIMIT ${input.limit}`)),
        ];

        record(
          rows.map((row) => ({
            label: row.excerpt,
            object: { kind: row.kind, id: row.object_id } as WireSource["object"],
            freshnessAt: row.as_of,
          })),
        );

        return {
          results: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            excerpt: row.excerpt,
            asOf: row.as_of,
          })),
          // The index is built by the worker; an empty result is not proof of absence.
          corpusComplete: rows.length > 0,
          sources: rows.map((row): ToolSource => ({ id: row.id, kind: row.kind, asOf: row.as_of })),
        };
      });
    },

    async explainAmount(input): Promise<AmountExplanationResult> {
      return tenant(scope, async (tx) => {
        if (input.objectType === "rent_term") return explainRentTerm(tx, input.objectId, record);
        if (input.objectType === "expense") return explainExpense(tx, input.objectId, record);
        throw new AppError("VALIDATION", {
          message: "Seuls un terme de loyer et une dépense se décomposent aujourd’hui.",
          details: { objectType: input.objectType },
        });
      });
    },

    async prepareCommand(input): Promise<PreparedCommand> {
      const parsed = CommandType.safeParse(input.kind);
      if (!parsed.success) {
        throw new AppError("VALIDATION", {
          message: "Type de commande inconnu.",
          details: { kind: input.kind },
        });
      }
      const commandType = parsed.data;
      const organizationId = scope.organizationId;

      const command = await tenant(scope, async (tx) => {
        const targetObjectRefId =
          isObjectKind(input.objectType) && input.objectId
            ? await ensureObjectRef(tx, {
                organizationId,
                kind: input.objectType,
                id: input.objectId,
              }).catch(() => null)
            : null;

        // UX-06 / IA-03: the assistant proposes; the row never leaves `prepared`.
        return createCommand(tx, {
          organizationId,
          commandType,
          operationKey: `assistant:${commandType}:${newId()}`,
          payload: {
            draft: true,
            summary: input.summary,
            objectType: input.objectType,
            objectId: input.objectId,
          },
          targetObjectRefId,
          actorUserId: scope.session?.user.id ?? null,
          autonomyLevel: resolveDecisionLevel(commandType),
          status: "prepared",
        });
      });

      lastCommandId = command.id;
      return { commandId: command.id, status: "prepared" };
    },
  };

  return {
    ports,
    takeSources: () => {
      const drained = sources;
      sources = [];
      return drained;
    },
    proposedCommandId: () => lastCommandId,
  };
}

async function explainRentTerm(
  tx: Tx,
  id: string,
  record: (entries: WireSource[]) => void,
): Promise<AmountExplanationResult> {
  const rows = [
    ...(await tx.execute<{
      version_id: string;
      rent_amount: string;
      charge_amount: string;
      accessory_amount: string;
      total_amount: string;
      currency: string;
    }>(sql`
      SELECT v.id AS version_id, v.rent_amount, v.charge_amount, v.accessory_amount,
             v.total_amount, v.currency
        FROM rent_term t JOIN rent_term_version v ON v.id = t.current_version_id
       WHERE t.id = ${id}::uuid LIMIT 1`)),
  ];
  const row = rows[0];
  if (!row) throw new AppError("NOT_FOUND", { details: { rentTermId: id } });

  record([{ label: "terme de loyer", object: { kind: "rent_term", id }, freshnessAt: null }]);
  return {
    amount: row.total_amount,
    currency: row.currency,
    breakdown: [
      { label: "Loyer hors charges", amount: row.rent_amount, sourceId: row.version_id },
      { label: "Charges", amount: row.charge_amount, sourceId: row.version_id },
      { label: "Accessoires", amount: row.accessory_amount, sourceId: row.version_id },
    ],
    sources: [{ id: row.version_id, kind: "rent_term_version", asOf: "" }],
  };
}

async function explainExpense(
  tx: Tx,
  id: string,
  record: (entries: WireSource[]) => void,
): Promise<AmountExplanationResult> {
  const rows = [
    ...(await tx.execute<{
      id: string;
      description: string;
      amount: string;
      currency: string;
      target: string;
    }>(sql`
      SELECT a.id, l.description, a.amount::text, a.currency, a.target
        FROM expense_line l JOIN expense_allocation a ON a.expense_line_id = l.id
       WHERE l.expense_id = ${id}::uuid
       ORDER BY l.line_number`)),
  ];
  if (rows.length === 0) throw new AppError("NOT_FOUND", { details: { expenseId: id } });

  record([{ label: "dépense", object: { kind: "expense", id }, freshnessAt: null }]);
  const total = rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2);
  return {
    amount: total,
    currency: rows[0]?.currency ?? "EUR",
    breakdown: rows.map((row) => ({
      label: `${row.description} (${row.target})`,
      amount: row.amount,
      sourceId: row.id,
    })),
    sources: rows.map((row): ToolSource => ({ id: row.id, kind: "expense_allocation", asOf: "" })),
  };
}
