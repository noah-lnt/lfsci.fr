import {
  prepareRentAccountingPayloadFixture,
  resolveDecisionLevel,
  sendMessagePayloadFixture,
} from "@lfsci/contracts";
import { describe, expect, it } from "vitest";
import { APPROVAL_TTL_HOURS, approvalExpiry, describeCommand, needsApproval } from "./decision";

describe("needsApproval", () => {
  it("routes A and B straight through, C and D to the owner (§17.1)", () => {
    expect(needsApproval("A")).toBe(false);
    expect(needsApproval("B")).toBe(false);
    expect(needsApproval("C")).toBe(true);
    expect(needsApproval("D")).toBe(true);
  });

  it("escalates a supplier bill whose payment identity changed", () => {
    expect(needsApproval(resolveDecisionLevel("post_supplier_bill"))).toBe(true);
    expect(resolveDecisionLevel("post_supplier_bill", { paymentIdentityChanged: true })).toBe("D");
  });
});

describe("approvalExpiry", () => {
  it("expires one working day after the decision (IA-03)", () => {
    const now = new Date("2026-09-20T08:00:00.000Z");
    expect(approvalExpiry(now)).toBe("2026-09-21T08:00:00.000Z");
    expect(APPROVAL_TTL_HOURS).toBe(24);
  });
});

describe("describeCommand", () => {
  it("shows the amount, the pieces and the expected effect of a rent posting", () => {
    const payload = prepareRentAccountingPayloadFixture;
    const summary = describeCommand({ command: "prepare_rent_accounting", payload });
    expect(summary.amount).toBe(payload.totalAmount);
    expect(summary.currency).toBe(payload.currency);
    expect(summary.pieces.length).toBeGreaterThan(0);
    expect(summary.expectedEffect).toContain("Odoo");
  });

  it("describes a message without inventing an amount", () => {
    const summary = describeCommand({
      command: "send_message",
      payload: sendMessagePayloadFixture,
    });
    expect(summary.amount).toBeNull();
    expect(summary.expectedEffect).toContain("irréversible");
  });
});
