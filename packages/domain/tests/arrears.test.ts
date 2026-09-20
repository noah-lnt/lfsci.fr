import { describe, expect, it } from "vitest";
import {
  autonomyForReminder,
  DEFAULT_REMINDER_POLICY,
  gradeReminder,
  isArrearsAutomationSuspended,
  outstandingOf,
  qualifyArrears,
} from "../src/payments";

const healthy = { ledgerStaleDays: 0, ledgerHealthy: true };

function qualify(overrides: Partial<Parameters<typeof qualifyArrears>[0]> = {}) {
  return qualifyArrears({
    termStatus: "posted",
    leaseStatus: "active",
    pendingAllocated: "0.00",
    unappliedCredit: "0.00",
    ...healthy,
    ...overrides,
  });
}

function grade(overrides: Partial<Parameters<typeof gradeReminder>[0]> = {}) {
  return gradeReminder({
    today: "2026-09-20",
    dueOn: "2026-09-05",
    outstanding: "780.00",
    qualification: "due",
    lastLevel: null,
    lastSentOn: null,
    ...overrides,
  });
}

describe("outstandingOf", () => {
  it("never reports a negative arrear when more was allocated than called", () => {
    expect(outstandingOf({ total: "780.00", allocated: "800.00" })).toBe("0.00");
    expect(outstandingOf({ total: "780.00", allocated: "500.00" })).toBe("280.00");
  });
});

describe("qualifyArrears (LOY-04)", () => {
  it("calls a plain unpaid term due", () => {
    expect(qualify()).toBe("due");
  });

  it("puts a dispute above every other signal", () => {
    expect(qualify({ leaseStatus: "disputed", pendingAllocated: "100.00" })).toBe("disputed");
    expect(qualify({ termStatus: "disputed" })).toBe("disputed");
  });

  it("reads a stale or unhealthy ledger as a synchronisation incident", () => {
    expect(qualify({ ledgerHealthy: false })).toBe("sync_incident");
    expect(qualify({ ledgerStaleDays: DEFAULT_REMINDER_POLICY.staleBankFeedDays + 1 })).toBe(
      "sync_incident",
    );
  });

  it("does not invent an incident when no ledger is wired yet", () => {
    expect(qualify({ ledgerStaleDays: null })).toBe("due");
  });

  it("separates a payment in transit from a receipt left unapplied", () => {
    expect(qualify({ pendingAllocated: "780.00" })).toBe("payment_in_transit");
    expect(qualify({ unappliedCredit: "780.00" })).toBe("unapplied_receipt");
  });

  it("suspends the automation on anything but a plain arrear", () => {
    expect(isArrearsAutomationSuspended("due")).toBe(false);
    for (const value of [
      "unapplied_receipt",
      "payment_in_transit",
      "disputed",
      "sync_incident",
    ] as const) {
      expect(isArrearsAutomationSuspended(value)).toBe(true);
    }
  });
});

describe("gradeReminder (LOY-04 ladder)", () => {
  it("holds inside the approved tolerance", () => {
    expect(grade({ today: "2026-09-09" })).toMatchObject({
      propose: false,
      reason: "within_grace",
    });
  });

  it("proposes a simple reminder once the first delay is reached", () => {
    expect(grade({ today: "2026-09-13" })).toEqual({
      propose: true,
      reason: null,
      level: "reminder_1",
      autonomy: "C",
      daysLate: 8,
    });
  });

  it("never jumps to a mise en demeure on a long-standing arrear", () => {
    expect(grade({ today: "2026-12-31" })).toMatchObject({ level: "reminder_1", autonomy: "C" });
    expect(
      grade({ today: "2026-12-31", lastLevel: "reminder_1", lastSentOn: "2026-10-01" }),
    ).toMatchObject({
      level: "reminder_2",
      autonomy: "C",
    });
  });

  it("grades the mise en demeure as a level-D decision", () => {
    expect(
      grade({ today: "2026-12-31", lastLevel: "reminder_2", lastSentOn: "2026-11-01" }),
    ).toMatchObject({ level: "formal_notice", autonomy: "D" });
    expect(autonomyForReminder("formal_notice")).toBe("D");
  });

  it("keeps the minimum spacing between two messages", () => {
    expect(
      grade({ today: "2026-12-31", lastLevel: "reminder_1", lastSentOn: "2026-12-28" }),
    ).toMatchObject({ propose: false, reason: "too_soon" });
  });

  it("waits for the second delay before escalating", () => {
    expect(
      grade({ today: "2026-09-16", lastLevel: "reminder_1", lastSentOn: "2026-09-01" }),
    ).toMatchObject({ propose: false, reason: "within_grace" });
  });

  it("stops after the mise en demeure instead of looping", () => {
    expect(
      grade({ today: "2026-12-31", lastLevel: "formal_notice", lastSentOn: "2026-11-30" }),
    ).toMatchObject({ propose: false, reason: "max_level_reached" });
  });

  it("holds on a settled, negligible or suspended situation", () => {
    expect(grade({ outstanding: "0.00" })).toMatchObject({ reason: "settled" });
    expect(grade({ today: "2026-12-31", outstanding: "1.00" })).toMatchObject({
      reason: "negligible_amount",
    });
    expect(grade({ today: "2026-12-31", qualification: "disputed" })).toMatchObject({
      reason: "suspended",
    });
  });
});
