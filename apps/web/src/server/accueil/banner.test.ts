import { describe, expect, it } from "vitest";
import { buildBanner } from "./banner";

const RUN_AT = "2026-09-20T02:30:00.000+00:00";

describe("buildBanner", () => {
  it("reports sources_unavailable when no control ever ran", () => {
    expect(buildBanner(null)).toEqual({
      controls: "sources_unavailable",
      lastRunAt: null,
      failed: ["aucun contrôle exécuté"],
    });
  });

  it("is complete only when every expected control ran clean", () => {
    const banner = buildBanner({
      occurredAt: RUN_AT,
      payload: { runAt: RUN_AT, expected: 7, executed: 7, failed: [], controls: [] },
    });
    expect(banner).toEqual({ controls: "complete", lastRunAt: RUN_AT, failed: [] });
  });

  it("never reports complete while a control failed", () => {
    const banner = buildBanner({
      occurredAt: RUN_AT,
      payload: {
        runAt: RUN_AT,
        expected: 7,
        executed: 7,
        failed: [],
        controls: [{ name: "payments_unallocated", status: "failed" }],
      },
    });
    expect(banner.controls).toBe("partial");
    expect(banner.failed).toEqual(["payments_unallocated"]);
  });

  it("reports partial when fewer controls ran than expected", () => {
    const banner = buildBanner({
      occurredAt: RUN_AT,
      payload: { runAt: RUN_AT, expected: 7, executed: 4, failed: [] },
    });
    expect(banner.controls).toBe("partial");
  });

  it("reports sources_unavailable when the run executed nothing", () => {
    const banner = buildBanner({
      occurredAt: RUN_AT,
      payload: { runAt: RUN_AT, expected: 7, executed: 0, failed: ["odoo"] },
    });
    expect(banner.controls).toBe("sources_unavailable");
  });
});
