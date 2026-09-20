import { describe, expect, it } from "vitest";
import { allocatePayment, receiptKind, type TermBalance } from "../src/payments";

const term = (over: Partial<TermBalance> = {}): TermBalance => ({
  termId: "term-2026-04",
  rent: "800.00",
  charges: "100.00",
  paidRent: "0.00",
  paidCharges: "0.00",
  ...over,
});

describe("F03 — partial payment, full payment and overpayment", () => {
  it("leaves 500 outstanding and issues a receipt after 400", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-1", amount: "400.00" },
      terms: [term()],
      allocations: [{ termId: "term-2026-04", rent: "400.00", charges: "0.00" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("fully_allocated");
    expect(result.terms[0]?.status).toBe("partial");
    expect(result.terms[0]?.outstanding).toBe("500.00");
    expect(result.terms[0]?.receipt).toBe("recu");
    expect(result.overpayment).toBe("0.00");
  });

  it("issues a single quittance of 900 once rent and charges are settled", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-2", amount: "500.00" },
      terms: [term({ paidRent: "400.00" })],
      allocations: [{ termId: "term-2026-04", rent: "400.00", charges: "100.00" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms[0]?.status).toBe("paid");
    expect(result.terms[0]?.outstanding).toBe("0.00");
    expect(result.terms[0]?.receipt).toBe("quittance");
    expect(result.allocated).toBe("500.00");
  });

  it("books the extra 100 as an overpayment, never as a new rent", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-3", amount: "100.00" },
      terms: [term({ paidRent: "800.00", paidCharges: "100.00" })],
      allocations: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("overpaid");
    expect(result.overpayment).toBe("100.00");
    expect(result.unallocated).toBe("100.00");
    expect(result.terms[0]?.outstanding).toBe("0.00");
    expect(result.terms[0]?.receipt).toBe("quittance");
  });

  it("keeps an unallocated remainder as a payment on account", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-4", amount: "900.00" },
      terms: [term()],
      allocations: [{ termId: "term-2026-04", rent: "400.00", charges: "0.00" }],
    });
    expect(result.ok && result.status).toBe("partial");
    expect(result.ok && result.unallocated).toBe("500.00");
    expect(result.ok && result.overpayment).toBe("0.00");
  });
});

describe("LOY-03 — receipt kind", () => {
  it("returns a quittance only when rent AND charges are fully paid", () => {
    expect(
      receiptKind({ rent: "800.00", charges: "100.00", paidRent: "800.00", paidCharges: "100.00" }),
    ).toBe("quittance");
    expect(
      receiptKind({ rent: "800.00", charges: "100.00", paidRent: "800.00", paidCharges: "99.99" }),
    ).toBe("recu");
    expect(
      receiptKind({ rent: "800.00", charges: "100.00", paidRent: "799.99", paidCharges: "100.00" }),
    ).toBe("recu");
  });
});

describe("allocation guards", () => {
  it("refuses more than the payment", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-5", amount: "100.00" },
      terms: [term()],
      allocations: [{ termId: "term-2026-04", rent: "200.00", charges: "0.00" }],
    });
    expect(result.ok === false && result.reason).toBe("allocation_exceeds_payment");
  });

  it("refuses more than the outstanding of a term", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-6", amount: "1000.00" },
      terms: [term()],
      allocations: [{ termId: "term-2026-04", rent: "900.00", charges: "0.00" }],
    });
    expect(result.ok === false && result.reason).toBe("allocation_exceeds_outstanding");
    expect(result.ok === false && result.missing).toEqual(["term-2026-04"]);
  });

  it("refuses an unknown term", () => {
    const result = allocatePayment({
      payment: { paymentId: "pay-7", amount: "10.00" },
      terms: [term()],
      allocations: [{ termId: "ghost", rent: "10.00", charges: "0.00" }],
    });
    expect(result.ok === false && result.reason).toBe("unknown_term");
  });
});
