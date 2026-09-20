import { describe, expect, it } from "vitest";
import { ActionCard } from "@/lib/contracts/accueil";
import { buildCards, type CardSource } from "./cards";

const EMPTY: CardSource = {
  today: "2026-09-20",
  lateRentTerms: [],
  commandExceptions: [],
  pendingApprovals: [],
  deadlines: [],
  inboxItems: [],
  missingDocuments: [],
};

const UUID = (suffix: string) => `0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${suffix}`;

function lateRent(id: string, dueOn: string) {
  return {
    rentTermId: UUID(id),
    leaseId: UUID(`b${id.slice(1)}`),
    leaseReference: `BAIL-${id}`,
    dueOn,
    totalAmount: "800.00",
    allocatedAmount: "0.00",
    currency: "EUR",
  };
}

describe("buildCards", () => {
  it("emits nothing when nothing is open", () => {
    expect(buildCards(EMPTY)).toEqual([]);
  });

  it("produces a card that matches the wire contract", () => {
    const [card] = buildCards({ ...EMPTY, lateRentTerms: [lateRent("5a", "2026-09-01")] });
    expect(ActionCard.safeParse(card).success).toBe(true);
    expect(card?.proposedAction.href).toContain("/finance");
    expect(card?.objectRefs).toContainEqual({ kind: "rent_term", id: UUID("5a") });
  });

  it("groups identical alerts instead of repeating them (UX-01)", () => {
    const cards = buildCards({
      ...EMPTY,
      lateRentTerms: [
        lateRent("5a", "2026-09-01"),
        lateRent("5b", "2026-09-02"),
        lateRent("5c", "2026-09-03"),
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.groupedCount).toBe(3);
    // The oldest incident dates the group, so the sort stays meaningful.
    expect(cards[0]?.occurredAt.slice(0, 10)).toBe("2026-09-01");
  });

  it("keeps two different causes apart", () => {
    const cards = buildCards({
      ...EMPTY,
      lateRentTerms: [lateRent("5a", "2026-09-01")],
      inboxItems: [
        {
          inboxItemId: "i1",
          status: "ambiguous",
          uncertaintyReason: null,
          occurredAt: "2026-09-19T08:00:00.000+00:00",
        },
      ],
    });
    expect(cards.map((card) => card.kind).sort()).toEqual(["inbox_ambiguous", "late_rent"]);
  });

  it("sorts critical first, then oldest", () => {
    const cards = buildCards({
      ...EMPTY,
      lateRentTerms: [lateRent("5a", "2026-09-15")],
      commandExceptions: [
        {
          commandId: "c1",
          commandType: "post_supplier_bill",
          status: "unknown_result",
          errorDetail: null,
          occurredAt: "2026-09-19T08:00:00.000+00:00",
        },
      ],
    });
    expect(cards[0]?.severity).toBe("critical");
    expect(cards[0]?.kind).toBe("command_exception");
  });

  it("escalates a rent late by more than a month", () => {
    const [recent] = buildCards({ ...EMPTY, lateRentTerms: [lateRent("5a", "2026-09-15")] });
    const [old] = buildCards({ ...EMPTY, lateRentTerms: [lateRent("5b", "2026-07-01")] });
    expect(recent?.severity).toBe("warning");
    expect(old?.severity).toBe("critical");
  });

  it("marks approvals and command exceptions as blocking", () => {
    const cards = buildCards({
      ...EMPTY,
      pendingApprovals: [
        {
          commandId: "c1",
          commandType: "revise_rent",
          level: "D",
          occurredAt: "2026-09-19T08:00:00.000+00:00",
        },
      ],
    });
    expect(cards[0]?.blocking).toBe(true);
  });
});
