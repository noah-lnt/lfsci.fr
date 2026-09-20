import type { ExistingRows, Plan, SourceRead, SourceReader } from "./model";
import { SourceUnreachable } from "./model";
import { buildPlan } from "./plan";

export type DryRunResult =
  | { ok: true; plan: Plan }
  | { ok: false; failures: { source: string; message: string }[] };

/** Every source is read before anything is judged; a source that cannot be read fails the run. */
export async function runDryRun(input: {
  organizationId: string;
  readers: SourceReader[];
  existing: () => Promise<ExistingRows>;
  now?: () => Date;
}): Promise<DryRunResult> {
  const failures: { source: string; message: string }[] = [];
  const reads: SourceRead[] = [];
  for (const reader of input.readers) {
    try {
      reads.push(await reader.read());
    } catch (error) {
      if (error instanceof SourceUnreachable) {
        failures.push({ source: reader.name, message: error.message });
        continue;
      }
      throw error;
    }
  }
  let existing: ExistingRows;
  try {
    existing = await input.existing();
  } catch (error) {
    failures.push({
      source: "database",
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, failures };
  }
  if (failures.length > 0) return { ok: false, failures };
  const plan = buildPlan({
    organizationId: input.organizationId,
    reads,
    existing,
    ...(input.now ? { now: input.now } : {}),
  });
  return { ok: true, plan };
}
