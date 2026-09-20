import { hashPayload, tables, withTenant } from "@lfsci/db";
import { logger, toAppError } from "@lfsci/kernel";
import type { IrlObservation } from "@lfsci/opendata";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { JobBase } from "../correlation";
import type { Deps } from "../deps";
import { forEachOrganizationId } from "../organizations";
import { defineJob, type JobOutcome } from "./registry";

const log = logger("job.irl.refresh");

export const IRL_RULE_CODE = "irl_index";
export const QUARTERS_KEPT = 4;

export const IrlRefreshData = JobBase.extend({});
export type IrlRefreshData = z.infer<typeof IrlRefreshData>;

export function lastQuarters(
  now: Date,
  count = QUARTERS_KEPT,
): { year: number; quarter: number }[] {
  const out: { year: number; quarter: number }[] = [];
  let year = now.getUTCFullYear();
  let quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let index = 0; index < count; index += 1) {
    out.push({ year, quarter });
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return out;
}

/**
 * There is no `rule_version.kind`: the IRL series is stored as the definition of
 * a `rule` with domain `rent_indexation` and code `irl_index`, one version per
 * refresh, sequence + 1. `definition_hash` makes a no-change refresh a no-op.
 */
async function storeSeries(
  deps: Deps,
  organizationId: string,
  observations: IrlObservation[],
): Promise<"created" | "unchanged"> {
  const definition = { series: "irl", observations };
  const definitionHash = hashPayload(definition);
  const effectiveFrom = deps.now().toISOString().slice(0, 10);

  return withTenant(deps.db, { organizationId }, async (tx) => {
    const existingRules = await tx
      .select()
      .from(tables.rule)
      .where(eq(tables.rule.code, IRL_RULE_CODE))
      .limit(1);
    let ruleId = existingRules[0]?.id;
    if (!ruleId) {
      const created = await tx
        .insert(tables.rule)
        .values({
          organizationId,
          code: IRL_RULE_CODE,
          domain: "rent_indexation",
          label: "Indice de référence des loyers (INSEE)",
          origin: "template",
          status: "active",
        })
        .returning({ id: tables.rule.id });
      ruleId = created[0]?.id;
    }
    if (!ruleId) return "unchanged";

    const versions = await tx
      .select()
      .from(tables.ruleVersion)
      .where(eq(tables.ruleVersion.ruleId, ruleId));
    if (versions.some((version) => version.definitionHash === definitionHash)) return "unchanged";

    const sequence = versions.reduce((max, version) => Math.max(max, version.sequence), 0) + 1;
    await tx
      .update(tables.ruleVersion)
      .set({ status: "superseded", updatedAt: new Date().toISOString() })
      .where(and(eq(tables.ruleVersion.ruleId, ruleId), eq(tables.ruleVersion.status, "active")));
    await tx.insert(tables.ruleVersion).values({
      organizationId,
      ruleId,
      sequence,
      definition,
      definitionHash,
      effectiveFrom,
      status: "active",
    });
    return "created";
  });
}

export async function refreshIrl(deps: Deps): Promise<JobOutcome> {
  if (!deps.insee) return { outcome: "sources_unavailable", missing: ["insee"] };

  let observations: IrlObservation[];
  try {
    const series = await deps.insee.fetchIrlSeries();
    const wanted = lastQuarters(deps.now()).map(({ year, quarter }) => `${year}-Q${quarter}`);
    observations = series
      .filter((entry) => wanted.includes(entry.period))
      .sort((a, b) => a.period.localeCompare(b.period));
  } catch (error) {
    const appError = toAppError(error);
    log.warn({ code: appError.code }, "IRL series unavailable");
    return { outcome: "sources_unavailable", missing: ["insee"], code: appError.code };
  }

  if (observations.length === 0) return { outcome: "no_observation" };

  let created = 0;
  for (const organizationId of await forEachOrganizationId(deps)) {
    if ((await storeSeries(deps, organizationId, observations)) === "created") created += 1;
  }
  return { outcome: "refreshed", observations: observations.length, organizations: created };
}

export const irlRefresh = defineJob({
  name: "irl.refresh",
  schema: IrlRefreshData,
  options: {
    retryLimit: 3,
    retryDelay: 3600,
    retryBackoff: true,
    retryDelayMax: 21600,
    expireInSeconds: 600,
    localConcurrency: 1,
  },
  // Quarterly, a few days after the INSEE publication window.
  schedule: { cron: "0 7 20 1,4,7,10 *", tz: "Europe/Paris" },
  handler: (_data, deps) => refreshIrl(deps),
});
