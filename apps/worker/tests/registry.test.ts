import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JobBase } from "../src/correlation";
import { jobNames, jobs } from "../src/jobs";
import { DEAD_LETTER_QUEUE, defineJob, runJob } from "../src/jobs/registry";
import { fakeDeps } from "./fakes";

const probe = defineJob({
  name: "test.probe",
  schema: JobBase.extend({ amount: z.number().int().positive() }),
  options: { retryLimit: 1, retryDelay: 1, retryBackoff: false, expireInSeconds: 30 },
  handler: async (data) => ({ outcome: "ok", amount: data.amount }),
});

describe("job registry", () => {
  it("runs a handler whose data passes its schema", async () => {
    const sent: { queue: string; data: object }[] = [];
    const result = await runJob(
      probe,
      { requestId: "0199a000-0000-7000-8000-000000000001", amount: 3 },
      fakeDeps(),
      async (queue, data) => {
        sent.push({ queue, data });
      },
    );
    expect(result).toEqual({ outcome: "ok", amount: 3 });
    expect(sent).toHaveLength(0);
  });

  it("dead-letters invalid data instead of retrying it", async () => {
    const sent: { queue: string; data: object }[] = [];
    const result = await runJob(probe, { amount: -1 }, fakeDeps(), async (queue, data) => {
      sent.push({ queue, data });
    });

    expect(result.outcome).toBe("dead_letter");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.queue).toBe(DEAD_LETTER_QUEUE);
    expect(sent[0]?.data).toMatchObject({ queue: "test.probe", reason: "invalid_data" });
  });

  it("mints a request id for a scheduled job that carries none", async () => {
    let seen: string | undefined;
    const scheduled = defineJob({
      name: "test.scheduled",
      schema: JobBase,
      options: { retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 30 },
      handler: async (data) => {
        seen = data.requestId;
        return { outcome: "ok" };
      },
    });
    await runJob(scheduled, {}, fakeDeps(), async () => undefined);
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("registers every queue exactly once and keeps the schedules declared", () => {
    expect(new Set(jobNames).size).toBe(jobNames.length);
    const scheduled = jobs.filter((job) => job.schedule);
    expect(scheduled.map((job) => [job.name, job.schedule?.cron])).toEqual([
      ["outbox.dispatch", "* * * * *"],
      ["rent.prepareTerms", "0 6 1 * *"],
      ["controls.nightly", "30 2 * * *"],
      ["deadlines.generate", "0 5 * * *"],
      ["odoo.backsync", "*/10 * * * *"],
      ["irl.refresh", "0 7 20 1,4,7,10 *"],
      ["retention.purge", "15 3 * * *"],
      ["search.index", "*/10 * * * *"],
      ["arrears.detect", "15 6 * * *"],
      ["email.dispatch", "* * * * *"],
      ["ical.poll", "0 * * * *"],
    ]);
    for (const job of scheduled) expect(job.schedule?.tz).toBe("Europe/Paris");
  });
});
