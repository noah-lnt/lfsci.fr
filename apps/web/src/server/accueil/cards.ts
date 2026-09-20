import type { ObjectRef } from "@lfsci/contracts";
import type { ActionCard, ActionCardSeverity } from "@/lib/contracts/accueil";

export type LateRentTermRow = {
  rentTermId: string;
  leaseId: string;
  leaseReference: string | null;
  dueOn: string;
  totalAmount: string;
  allocatedAmount: string;
  currency: string;
};

export type CommandExceptionRow = {
  commandId: string;
  commandType: string;
  status: "unknown_result" | "conflict" | "rejected";
  errorDetail: string | null;
  occurredAt: string;
};

export type PendingApprovalRow = {
  commandId: string;
  commandType: string;
  level: "A" | "B" | "C" | "D";
  occurredAt: string;
};

export type DeadlineCardRow = {
  deadlineId: string;
  title: string;
  type: string;
  dueOn: string;
  priority: "low" | "normal" | "high" | "critical";
  objects: ObjectRef[];
};

export type InboxCardRow = {
  inboxItemId: string;
  status: "received" | "ambiguous";
  uncertaintyReason: string | null;
  occurredAt: string;
};

export type MissingDocumentRow = {
  id: string;
  label: string;
  objects: ObjectRef[];
  occurredAt: string;
};

export type CardSource = {
  /** Civil day in Europe/Paris, `YYYY-MM-DD`. */
  today: string;
  lateRentTerms: LateRentTermRow[];
  commandExceptions: CommandExceptionRow[];
  pendingApprovals: PendingApprovalRow[];
  deadlines: DeadlineCardRow[];
  inboxItems: InboxCardRow[];
  missingDocuments: MissingDocumentRow[];
};

const SEVERITY_RANK: Record<ActionCardSeverity, number> = { critical: 0, warning: 1, info: 2 };

const GROUP_LABEL: Record<string, string> = {
  late_rent: "loyers non reçus",
  command_exception: "commandes en exception",
  approval_pending: "validations en attente",
  deadline_due: "échéances",
  inbox_ambiguous: "éléments d’inbox à trier",
  document_missing: "pièces manquantes",
};

type Draft = ActionCard & { groupKey: string; groupHref: string };

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function atNoon(day: string): string {
  return `${day}T12:00:00.000Z`;
}

function remaining(row: LateRentTermRow): string {
  const value = Number(row.totalAmount) - Number(row.allocatedAmount);
  return value.toFixed(2);
}

function lateRentCards(source: CardSource): Draft[] {
  return source.lateRentTerms.map((row) => {
    const late = daysBetween(row.dueOn, source.today);
    const label = row.leaseReference ?? row.leaseId;
    return {
      id: `late_rent:${row.rentTermId}`,
      kind: "late_rent",
      why: `Le terme du bail ${label}, échu le ${row.dueOn}, reste dû de ${remaining(row)} ${row.currency} depuis ${late} jour(s).`,
      blocking: false,
      proposedAction: {
        label: "Rapprocher un encaissement",
        href: `/locations/recouvrement?rentTerm=${row.rentTermId}`,
      },
      expectedEffect: "Le terme passe à réglé et la quittance devient préparable.",
      severity: late > 30 ? "critical" : "warning",
      objectRefs: [
        { kind: "rent_term", id: row.rentTermId },
        { kind: "lease", id: row.leaseId },
      ],
      occurredAt: atNoon(row.dueOn),
      groupKey: "late_rent",
      groupHref: "/locations/recouvrement",
    } satisfies Draft;
  });
}

function commandExceptionCards(source: CardSource): Draft[] {
  const why: Record<CommandExceptionRow["status"], string> = {
    unknown_result: "Le résultat de l’appel externe est inconnu ; rien n’est confirmé.",
    conflict: "L’état externe ne correspond plus à ce qui a été envoyé.",
    rejected: "Le service externe a refusé l’opération.",
  };
  return source.commandExceptions.map((row) => ({
    id: `command_exception:${row.commandId}`,
    kind: "command_exception",
    why: `${row.commandType} — ${why[row.status]}${row.errorDetail ? ` (${row.errorDetail})` : ""}`,
    blocking: true,
    proposedAction: { label: "Ouvrir la commande", href: `/admin/ops?command=${row.commandId}` },
    expectedEffect:
      row.status === "rejected"
        ? "La commande est corrigée puis resoumise, sans double exécution."
        : "La réconciliation confirme ou compense l’opération.",
    severity: row.status === "rejected" ? "warning" : "critical",
    objectRefs: [],
    occurredAt: row.occurredAt,
    groupKey: `command_exception:${row.status}`,
    groupHref: "/admin/ops",
  }));
}

function approvalCards(source: CardSource): Draft[] {
  return source.pendingApprovals.map((row) => ({
    id: `approval_pending:${row.commandId}`,
    kind: "approval_pending",
    why: `La commande ${row.commandType} est de niveau ${row.level} : elle attend votre validation explicite.`,
    blocking: true,
    proposedAction: { label: "Valider ou refuser", href: `/validations#${row.commandId}` },
    expectedEffect: "La commande passe à autorisée et part vers la file d’envoi.",
    severity: row.level === "D" ? "critical" : "warning",
    objectRefs: [],
    occurredAt: row.occurredAt,
    groupKey: `approval_pending:${row.commandType}`,
    groupHref: "/validations",
  }));
}

function deadlineCards(source: CardSource): Draft[] {
  return source.deadlines.map((row) => {
    const late = daysBetween(row.dueOn, source.today);
    const overdue = late > 0;
    return {
      id: `deadline_due:${row.deadlineId}`,
      kind: "deadline_due",
      why: overdue
        ? `${row.title} était attendue le ${row.dueOn} — ${late} jour(s) de retard.`
        : `${row.title} arrive à échéance le ${row.dueOn}.`,
      blocking: false,
      proposedAction: { label: "Ouvrir l’échéance", href: `/echeancier#${row.deadlineId}` },
      expectedEffect: "L’échéance est accomplie sur un fait daté, ou reportée avec un motif.",
      severity: row.priority === "critical" ? "critical" : overdue ? "warning" : "info",
      objectRefs: row.objects,
      occurredAt: atNoon(row.dueOn),
      groupKey: `deadline_due:${overdue ? "overdue" : "soon"}`,
      groupHref: overdue ? "/echeancier?horizon=overdue" : "/echeancier?horizon=d7",
    } satisfies Draft;
  });
}

function inboxCards(source: CardSource): Draft[] {
  return source.inboxItems.map((row) => ({
    id: `inbox_ambiguous:${row.inboxItemId}`,
    kind: "inbox_ambiguous",
    why:
      row.status === "ambiguous"
        ? `Élément d’inbox ambigu : ${row.uncertaintyReason ?? "rattachement incertain"}.`
        : "Élément reçu, pas encore rattaché.",
    blocking: row.status === "ambiguous",
    proposedAction: { label: "Trier l’élément", href: `/inbox?item=${row.inboxItemId}` },
    expectedEffect: "L’élément est rattaché à son objet et quitte la file de tri.",
    severity: row.status === "ambiguous" ? "warning" : "info",
    objectRefs: [],
    occurredAt: row.occurredAt,
    groupKey: `inbox_ambiguous:${row.status}`,
    groupHref: "/inbox",
  }));
}

function missingDocumentCards(source: CardSource): Draft[] {
  return source.missingDocuments.map((row) => ({
    id: `document_missing:${row.id}`,
    kind: "document_missing",
    why: `${row.label} : pièce absente ou périmée sur un bail actif.`,
    blocking: true,
    proposedAction: { label: "Déposer la pièce", href: `/documents?missing=${row.id}` },
    expectedEffect: "Le dossier du bail redevient complet et l’alerte se ferme.",
    severity: "warning",
    objectRefs: row.objects,
    occurredAt: row.occurredAt,
    groupKey: "document_missing",
    groupHref: "/documents?filter=missing",
  }));
}

/**
 * UX-01: identical alerts collapse into one card carrying the count, so a single
 * root cause (a disconnected bank) cannot produce a hundred rent cards.
 */
function group(drafts: Draft[]): ActionCard[] {
  const buckets = new Map<string, Draft[]>();
  for (const draft of drafts) {
    const bucket = buckets.get(draft.groupKey);
    if (bucket) bucket.push(draft);
    else buckets.set(draft.groupKey, [draft]);
  }

  const out: ActionCard[] = [];
  for (const [key, bucket] of buckets) {
    const first = bucket[0];
    if (!first) continue;
    if (bucket.length === 1) {
      const { groupKey: _key, groupHref: _href, ...card } = first;
      out.push(card);
      continue;
    }
    const oldest = bucket.reduce((a, b) => (a.occurredAt <= b.occurredAt ? a : b));
    const worst = bucket.reduce((a, b) =>
      SEVERITY_RANK[a.severity] <= SEVERITY_RANK[b.severity] ? a : b,
    );
    const label = GROUP_LABEL[key.split(":")[0] ?? ""] ?? "éléments";
    out.push({
      id: `group:${key}`,
      kind: first.kind,
      why: `${bucket.length} ${label} de même nature, le plus ancien depuis le ${oldest.occurredAt.slice(0, 10)}.`,
      blocking: bucket.some((draft) => draft.blocking),
      proposedAction: { label: "Voir la liste", href: first.groupHref },
      expectedEffect: first.expectedEffect,
      severity: worst.severity,
      objectRefs: bucket.flatMap((draft) => draft.objectRefs).slice(0, 10),
      occurredAt: oldest.occurredAt,
      groupedCount: bucket.length,
    });
  }
  return out;
}

export function buildCards(source: CardSource): ActionCard[] {
  const drafts = [
    ...approvalCards(source),
    ...commandExceptionCards(source),
    ...lateRentCards(source),
    ...deadlineCards(source),
    ...inboxCards(source),
    ...missingDocumentCards(source),
  ];
  return group(drafts).sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.occurredAt.localeCompare(b.occurredAt);
  });
}
