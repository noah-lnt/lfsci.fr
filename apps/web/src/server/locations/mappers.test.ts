import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  decodeCursor,
  encodeCursor,
  instant,
  missingPieces,
  nextDueOn,
  outstandingOf,
  receiptKindOf,
  settlementOf,
  splitOnRentFirst,
  sumMoney,
  usageForLeaseKind,
} from "./mappers";

const lease = {
  startsOn: "2026-01-01",
  rentExclCharges: "900.00",
  depositAmount: "900.00",
  paymentDay: 5,
};
const holder = [{ role: "holder" }];
const mainUnit = [{ role: "main" }];

describe("splitOnRentFirst", () => {
  it("fills the rent before the charges", () => {
    expect(splitOnRentFirst("500.00", "900.00", "60.00")).toEqual({
      rent: "500.00",
      charges: "0.00",
    });
  });

  it("spills over to the charges once the rent is covered", () => {
    expect(splitOnRentFirst("930.00", "900.00", "60.00")).toEqual({
      rent: "900.00",
      charges: "30.00",
    });
  });

  it("never allocates more than what is due", () => {
    expect(splitOnRentFirst("1000.00", "900.00", "60.00")).toEqual({
      rent: "900.00",
      charges: "60.00",
    });
  });
});

describe("receiptKindOf", () => {
  it("refuses a quittance while the term is partially paid (LOY-03)", () => {
    expect(
      receiptKindOf({ rentAmount: "900.00", chargeAmount: "60.00", paidAmount: "500.00" }),
    ).toBe("recu");
  });

  it("refuses a quittance when the rent is settled but the charges are not", () => {
    expect(
      receiptKindOf({ rentAmount: "900.00", chargeAmount: "60.00", paidAmount: "900.00" }),
    ).toBe("recu");
  });

  it("allows a quittance once rent and charges are settled", () => {
    expect(
      receiptKindOf({ rentAmount: "900.00", chargeAmount: "60.00", paidAmount: "960.00" }),
    ).toBe("quittance");
  });
});

describe("balances", () => {
  it("reports the settlement state", () => {
    expect(settlementOf("0.00", "960.00")).toBe("unpaid");
    expect(settlementOf("500.00", "960.00")).toBe("partial");
    expect(settlementOf("960.00", "960.00")).toBe("paid");
  });

  it("never reports a negative outstanding", () => {
    expect(outstandingOf("960.00", "1000.00")).toBe("0.00");
    expect(outstandingOf("960.00", "500.00")).toBe("460.00");
  });

  it("sums decimal strings without floats", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
  });

  it("takes the earliest unsettled due date", () => {
    expect(
      nextDueOn([
        { dueOn: "2026-03-05", outstanding: "960.00" },
        { dueOn: "2026-02-05", outstanding: "0.00" },
        { dueOn: "2026-04-05", outstanding: "960.00" },
      ]),
    ).toBe("2026-03-05");
  });
});

describe("missingPieces (BAI-01)", () => {
  it("lists nothing when the lease is complete", () => {
    expect(missingPieces({ lease, parties: holder, units: mainUnit })).toEqual([]);
  });

  it("names each missing piece", () => {
    expect(
      missingPieces({
        lease: { startsOn: null, rentExclCharges: null, depositAmount: null, paymentDay: null },
        parties: [],
        units: [{ role: "annex" }],
      }),
    ).toEqual(["party", "unit", "dates", "rent", "deposit"]);
  });
});

describe("lifecycle", () => {
  it("follows the state table of spec §13.3", () => {
    expect(allowedTransitions("draft")).toEqual(["ready_to_sign", "cancelled"]);
    expect(allowedTransitions("signed")).toContain("active");
    expect(allowedTransitions("archived")).toEqual([]);
  });

  it("maps a lease kind onto the unit usage", () => {
    expect(usageForLeaseKind("furnished")).toBe("furnished_rental");
    expect(usageForLeaseKind("bare")).toBe("bare_rental");
    expect(usageForLeaseKind("commercial")).toBe("commercial_rental");
  });
});

describe("timestamps", () => {
  it("turns the Postgres rendering into ISO-8601 with an offset", () => {
    expect(instant("2026-09-20 06:14:13.998876+00")).toBe("2026-09-20T06:14:13.998Z");
  });

  it("accepts what the driver may already have parsed", () => {
    expect(instant(new Date("2026-09-20T06:14:13.000Z"))).toBe("2026-09-20T06:14:13.000Z");
  });
});

describe("cursor", () => {
  it("round-trips a sort key holding a separator", () => {
    const cursor = encodeCursor("2026-01-01|x", "a1b2");
    expect(decodeCursor(cursor)).toEqual({ sortKey: "2026-01-01|x", id: "a1b2" });
  });

  it("reads an absent cursor as no cursor", () => {
    expect(decodeCursor(undefined)).toBeNull();
  });
});
