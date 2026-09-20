import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Component graph; the boundary it
// guards is a lint concern, not something these pure functions exercise.
vi.mock("server-only", () => ({}));

const { compareFindings, compareInventory, exitConforms, prepareSettlement } = await import(
  "./comparison"
);

type Finding = Parameters<typeof compareFindings>[0][number];
type Item = Parameters<typeof compareInventory>[0][number];

function finding(id: string, room: string | null, element: string, condition: string): Finding {
  return {
    id,
    room,
    element,
    condition: condition as Finding["condition"],
    description: null,
  };
}

function item(id: string, label: string, entry: boolean | null, exit: boolean | null): Item {
  return {
    id,
    label,
    category: "cuisine",
    quantity: "1.000",
    condition: "good",
    presentAtEntry: entry,
    presentAtExit: exit,
  };
}

describe("compareFindings", () => {
  it("proposes only the new defect, not the one already present at entry", () => {
    const entry = [
      finding("f1", "Séjour", "Mur nord", "damaged"),
      finding("f2", "Cuisine", "Plan de travail", "good"),
    ];
    const exit = [
      finding("f3", "Séjour", "Mur nord", "damaged"),
      finding("f4", "Cuisine", "Plan de travail", "damaged"),
    ];

    const differences = compareFindings(entry, exit);
    const proposed = differences.filter((difference) => difference.proposedForReview);

    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.element).toBe("Plan de travail");
    expect(proposed[0]?.status).toBe("degraded");
    expect(differences.find((d) => d.element === "Mur nord")?.status).toBe("unchanged");
  });

  it("matches the same room typed with different accents and spacing", () => {
    const differences = compareFindings(
      [finding("f1", "Chambre  1", "Fenêtre", "good")],
      [finding("f2", "chambre 1", "fenetre", "damaged")],
    );

    expect(differences).toHaveLength(1);
    expect(differences[0]?.status).toBe("degraded");
    expect(differences[0]?.entryFindingId).toBe("f1");
  });

  it("does not propose an unseen element in good condition, nor an unchecked one", () => {
    const differences = compareFindings(
      [],
      [
        finding("f1", "Entrée", "Interrupteur", "good"),
        finding("f2", "Entrée", "Plafond", "not_checked"),
      ],
    );

    expect(differences.find((d) => d.element === "Interrupteur")).toMatchObject({
      status: "new",
      proposedForReview: false,
    });
    expect(differences.find((d) => d.element === "Plafond")).toMatchObject({
      status: "undetermined",
      proposedForReview: false,
    });
  });

  it("keeps an entry finding that the exit never revisited, without proposing it", () => {
    const differences = compareFindings([finding("f1", "Cave", "Porte", "worn")], []);

    expect(differences).toEqual([
      expect.objectContaining({
        status: "not_observed",
        proposedForReview: false,
        exitFindingId: null,
      }),
    ]);
  });
});

describe("compareInventory", () => {
  it("reports a missing item for a decision and never as an amount", () => {
    const differences = compareInventory([
      item("i1", "Table", true, false),
      item("i2", "Chaises", true, true),
      item("i3", "Lampe", false, true),
      item("i4", "Rideaux", true, null),
    ]);

    expect(differences.map((d) => d.status)).toEqual([
      "missing",
      "present",
      "added",
      "undetermined",
    ]);
    expect(differences.filter((d) => d.requiresDecision).map((d) => d.label)).toEqual(["Table"]);
    for (const difference of differences) {
      expect(difference).not.toHaveProperty("amount");
    }
  });
});

describe("exitConforms", () => {
  it("is false as soon as a defect is proposed or an item is missing", () => {
    const clean = compareFindings([], [finding("f1", "Séjour", "Mur", "good")]);
    expect(exitConforms(clean, [])).toBe(true);
    expect(exitConforms(clean, compareInventory([item("i1", "Table", true, false)]))).toBe(false);

    const damaged = compareFindings([], [finding("f1", "Séjour", "Mur", "damaged")]);
    expect(exitConforms(damaged, [])).toBe(false);
  });
});

describe("prepareSettlement", () => {
  it("gives one month when the exit conforms, two when it does not", () => {
    const conforming = prepareSettlement({
      depositHeld: "900.00",
      keyHandoverDate: "2026-09-10",
      conforms: true,
      candidates: [],
    });
    expect(conforming.settlement).toMatchObject({
      deadline: "2026-10-10",
      deadlineMonths: 1,
      restitution: "900.00",
    });

    const contested = prepareSettlement({
      depositHeld: "900.00",
      keyHandoverDate: "2026-09-10",
      conforms: false,
      candidates: [{ findingId: "f1", amount: "150.00", justificationIds: ["d1"] }],
    });
    expect(contested.settlement).toMatchObject({
      deadline: "2026-11-10",
      deadlineMonths: 2,
      totalDeductions: "150.00",
      restitution: "750.00",
    });
  });

  it("refuses a deduction with no justification and waits for the keys", () => {
    expect(
      prepareSettlement({
        depositHeld: "900.00",
        keyHandoverDate: "2026-09-10",
        conforms: false,
        candidates: [{ findingId: "f1", amount: "150.00", justificationIds: [] }],
      }),
    ).toEqual({ settlement: null, blockedReason: "deduction_without_justification" });

    expect(
      prepareSettlement({
        depositHeld: "900.00",
        keyHandoverDate: null,
        conforms: true,
        candidates: [],
      }),
    ).toEqual({ settlement: null, blockedReason: "keys_not_handed_over" });
  });

  it("EDL-02: a missing inventory item alone withholds nothing", () => {
    const inventory = compareInventory([item("i1", "Table", true, false)]);
    const differences = compareFindings([], []);

    const prepared = prepareSettlement({
      depositHeld: "900.00",
      keyHandoverDate: "2026-09-10",
      conforms: exitConforms(differences, inventory),
      candidates: [],
    });

    expect(prepared.settlement).toMatchObject({
      totalDeductions: "0.00",
      restitution: "900.00",
      deadlineMonths: 2,
    });
  });
});
