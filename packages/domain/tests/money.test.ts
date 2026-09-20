import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { money, roundCent, splitByShares, splitEqually, sum, toMoney, ZERO } from "../src/money";

describe("money", () => {
  it("rejects a non-money string", () => {
    expect(() => money("12.345")).toThrow();
    expect(() => money("abc")).toThrow();
  });

  it("rounds half up to the cent", () => {
    expect(toMoney(money("100.00").times(1.005))).toBe("100.50");
    expect(roundCent(money("0.01").dividedBy(2)).toFixed(2)).toBe("0.01");
    expect(toMoney(new Decimal("2.675"))).toBe("2.68");
    expect(toMoney(new Decimal("-2.675"))).toBe("-2.68");
  });

  it("sums an empty list to zero", () => {
    expect(toMoney(sum([]))).toBe("0.00");
    expect(toMoney(ZERO)).toBe("0.00");
  });
});

describe("F06 — largest remainder on 100 / 3", () => {
  const ids = ["lot-a", "lot-b", "lot-c"];

  it("splits 100.00 into 33.34 + 33.33 + 33.33", () => {
    const parts = splitEqually(money("100.00"), ids).map((p) => toMoney(p.amount));
    expect(parts).toEqual(["33.34", "33.33", "33.33"]);
    expect(toMoney(sum(splitEqually(money("100.00"), ids).map((p) => p.amount)))).toBe("100.00");
  });

  it("gives the residual cent to the same lot on every replay", () => {
    for (let i = 0; i < 5; i += 1) {
      const parts = splitEqually(money("100.00"), ids);
      expect(parts[0]?.id).toBe("lot-a");
      expect(toMoney(parts[0]?.amount ?? ZERO)).toBe("33.34");
    }
  });

  it("keeps the stable order whatever the input order", () => {
    const shuffled = splitEqually(money("100.00"), ["lot-c", "lot-b", "lot-a"]);
    const byId = new Map(shuffled.map((p) => [p.id, toMoney(p.amount)]));
    expect(byId.get("lot-a")).toBe("33.34");
    expect(byId.get("lot-b")).toBe("33.33");
    expect(byId.get("lot-c")).toBe("33.33");
  });

  it("never produces 99.99 nor 100.01", () => {
    const total = sum(splitEqually(money("100.00"), ids).map((p) => p.amount));
    expect(toMoney(total)).not.toBe("99.99");
    expect(toMoney(total)).not.toBe("100.01");
  });
});

describe("splitByShares", () => {
  it("applies contractual keys exactly", () => {
    const parts = splitByShares(money("1200.00"), [
      { id: "A", share: "0.5" },
      { id: "B", share: "0.3" },
      { id: "C", share: "0.2" },
    ]).map((p) => toMoney(p.amount));
    expect(parts).toEqual(["600.00", "360.00", "240.00"]);
  });

  it("handles a negative amount without losing a cent", () => {
    const parts = splitEqually(money("-100.00"), ["a", "b", "c"]).map((p) => toMoney(p.amount));
    expect(parts).toEqual(["-33.34", "-33.33", "-33.33"]);
    expect(toMoney(sum(splitEqually(money("-100.00"), ["a", "b", "c"]).map((p) => p.amount)))).toBe(
      "-100.00",
    );
  });

  it("is zero-safe", () => {
    expect(splitEqually(money("0.00"), ["a", "b"]).map((p) => toMoney(p.amount))).toEqual([
      "0.00",
      "0.00",
    ]);
    expect(splitByShares(money("10.00"), [])).toEqual([]);
    expect(
      splitByShares(money("10.00"), [{ id: "a", share: "0" }]).map((p) => toMoney(p.amount)),
    ).toEqual(["10.00"]);
  });
});
