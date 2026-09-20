import type { api } from "@lfsci/contracts";

export type SituationBanner = api.actionRequired.SituationBanner;

export type ControlRunEvent = { occurredAt: string; payload: unknown } | null;

type ControlEntry = { name?: unknown; status?: unknown };

function names(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function failedControls(controls: unknown): string[] {
  if (!Array.isArray(controls)) return [];
  return controls
    .filter((entry): entry is ControlEntry => typeof entry === "object" && entry !== null)
    .filter((entry) => entry.status === "failed")
    .map((entry) => (typeof entry.name === "string" ? entry.name : "contrôle inconnu"));
}

/**
 * UX-01: a green state is impossible while a control failed or never ran — an
 * absent report reads `sources_unavailable`, never "tout va bien".
 */
export function buildBanner(event: ControlRunEvent): SituationBanner {
  if (!event) {
    return { controls: "sources_unavailable", lastRunAt: null, failed: ["aucun contrôle exécuté"] };
  }
  const payload = (
    typeof event.payload === "object" && event.payload !== null ? event.payload : {}
  ) as Record<string, unknown>;

  const expected = Number(payload.expected ?? 0);
  const executed = Number(payload.executed ?? 0);
  const failed = [...new Set([...names(payload.failed), ...failedControls(payload.controls)])];
  const lastRunAt = typeof payload.runAt === "string" ? payload.runAt : event.occurredAt;

  if (executed === 0) return { controls: "sources_unavailable", lastRunAt, failed };
  if (failed.length > 0 || executed < expected) return { controls: "partial", lastRunAt, failed };
  return { controls: "complete", lastRunAt, failed: [] };
}
