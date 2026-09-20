import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseCsv } from "./csv";
import { parseCivilDate, parseMoney, resolveMapping } from "./mapping";
import { type KnownBooking, newBookings, newPayouts, type PlanContext, planImport } from "./plan";

const BOOKINGS_CSV = [
  "Code de confirmation;Annonce;Arrivée;Départ;Voyageur;Nombre de voyageurs;Hébergement;Frais de ménage;Frais de service;Remboursement;Taxe de séjour collectée;Taxe de séjour reversée;Devise;Versement;Date de versement;Montant versé",
  'HMABC1;Studio Vue Mer;14/07/2026;19/07/2026;"Martin, Camille";2;820,00;70,00;26,70;0,00;24,00;24,00;EUR;PAY-2026-07;25/07/2026;1309,50',
  "HMABC2;Studio Vue Mer;01/08/2026;04/08/2026;Dominique Leroy;3;540,00;70,00;13,80;150,00;16,00;16,00;EUR;PAY-2026-07;25/07/2026;1309,50",
  "",
].join("\n");

/** Same file, columns in another order: the mapping reads names, never positions. */
const REORDERED_CSV = [
  "Devise;Départ;Montant versé;Hébergement;Voyageur;Code de confirmation;Frais de service;Date de versement;Taxe de séjour reversée;Arrivée;Nombre de voyageurs;Remboursement;Annonce;Frais de ménage;Taxe de séjour collectée;Versement",
  'EUR;19/07/2026;1309,50;820,00;"Martin, Camille";HMABC1;26,70;25/07/2026;24,00;14/07/2026;2;0,00;Studio Vue Mer;70,00;24,00;PAY-2026-07',
  "EUR;04/08/2026;1309,50;540,00;Dominique Leroy;HMABC2;13,80;25/07/2026;16,00;01/08/2026;3;150,00;Studio Vue Mer;70,00;16,00;PAY-2026-07",
  "",
].join("\n");

const PAYOUTS_CSV = [
  "Référence du versement,Date de versement,Montant versé,Code de confirmation,Montant de la ligne,Nature,Libellé",
  "PAY-2026-07,2026-07-25,1264.50,HMABC1,863.30,Réservation,Studio Vue Mer",
  "PAY-2026-07,2026-07-25,1264.50,HMABC2,446.20,Réservation,Studio Vue Mer",
  'PAY-2026-07,2026-07-25,1264.50,,-45.00,Retenue,"Retenue, période précédente"',
  "",
].join("\n");

function emptyContext(): PlanContext {
  return { knownBookings: new Map(), knownPayoutIds: new Set() };
}

function knownFrom(reference: string, amounts: Partial<KnownBooking>): KnownBooking {
  return {
    id: `00000000-0000-4000-8000-${reference.padEnd(12, "0").slice(0, 12)}`,
    externalBookingId: reference,
    accommodation: "0.00",
    cleaning: "0.00",
    extras: "0.00",
    commission: "0.00",
    refunds: "0.00",
    taxCollected: "0.00",
    taxRemitted: "0.00",
    ...amounts,
  };
}

function planBookingsCsv(csv: string, context: PlanContext = emptyContext()) {
  return planImport({
    mapping: resolveMapping("airbnb-reservations-fr-v1"),
    table: parseCsv(csv),
    context,
  });
}

describe("AIR-02 — CSV reading", () => {
  it("keeps a quoted delimiter, a doubled quote and an embedded newline inside one cell", () => {
    const table = parseCsv(["a,b,c", '"x, y","he said ""ok""","first', 'second",3', ""].join("\n"));
    expect(table.delimiter).toBe(",");
    expect(table.headers).toEqual(["a", "b", "c"]);
    expect(table.records).toHaveLength(1);
    expect(table.records[0]?.cells).toEqual(["x, y", 'he said "ok"', "first\nsecond", "3"]);
  });

  it("sniffs the semicolon of a French export", () => {
    expect(parseCsv(BOOKINGS_CSV).delimiter).toBe(";");
  });

  it("reads dates and amounts in the order the mapping version declares", () => {
    expect(parseCivilDate("14/07/2026", "dmy")).toBe("2026-07-14");
    expect(parseCivilDate("07/14/2026", "mdy")).toBe("2026-07-14");
    expect(parseCivilDate("2026-07-14", "ymd")).toBe("2026-07-14");
    expect(parseCivilDate("32/07/2026", "dmy")).toBeNull();
    expect(parseMoney("1 309,50 €", "comma")).toBe("1309.50");
    expect(parseMoney("1,309.50", "point")).toBe("1309.50");
    expect(parseMoney("(45.00)", "point")).toBe("-45.00");
    expect(parseMoney("abc", "point")).toBeNull();
  });
});

describe("AIR-02 — mapping by header name", () => {
  it("maps every declared column and reports the ones the file does not carry", () => {
    const plan = planBookingsCsv(BOOKINGS_CSV);
    expect(plan.missingColumns).toEqual([]);
    expect(plan.unknownColumns).toEqual([]);
    expect(plan.mappedColumns).toContainEqual({
      field: "externalBookingId",
      header: "Code de confirmation",
    });
    expect(plan.mappedColumns).toContainEqual({ field: "checkInOn", header: "Arrivée" });
    expect(plan.blocked).toBe(false);
  });

  it("produces the same plan when the columns are reordered", () => {
    const straight = planBookingsCsv(BOOKINGS_CSV);
    const shuffled = planBookingsCsv(REORDERED_CSV);
    expect(shuffled.bookings).toEqual(straight.bookings);
    expect(shuffled.payouts.map((payout) => payout.reconciliation)).toEqual(
      straight.payouts.map((payout) => payout.reconciliation),
    );
  });

  it("blocks on a missing required column instead of guessing a position", () => {
    const csv = BOOKINGS_CSV.replace("Code de confirmation;", "Identifiant interne;");
    const plan = planBookingsCsv(csv);
    expect(plan.missingColumns).toContain("Code de confirmation");
    expect(plan.blockedReasons).toContain("missing_columns");
    expect(plan.blocked).toBe(true);
  });

  it("reads the stay, the guest and the amounts of each row", () => {
    const [first, second] = planBookingsCsv(BOOKINGS_CSV).bookings;
    expect(first).toMatchObject({
      line: 2,
      externalBookingId: "HMABC1",
      checkInOn: "2026-07-14",
      checkOutOn: "2026-07-19",
      nights: 5,
      guestName: "Martin, Camille",
      guestCount: 2,
      net: "863.30",
    });
    expect(first?.amounts).toEqual({
      accommodation: "820.00",
      cleaning: "70.00",
      commission: "26.70",
      refund: "0.00",
      touristTaxCollected: "24.00",
      touristTaxRemitted: "24.00",
      deposit: "0.00",
    });
    expect(second?.net).toBe("446.20");
  });
});

describe("AIR-02 — deduplication on the platform identifiers", () => {
  it("writes nothing the second time the same file is imported", () => {
    const first = planBookingsCsv(BOOKINGS_CSV);
    expect(newBookings(first)).toHaveLength(2);
    expect(newPayouts(first)).toHaveLength(1);

    const context: PlanContext = {
      knownBookings: new Map(
        first.bookings.map((booking) => [
          booking.externalBookingId,
          knownFrom(booking.externalBookingId, {
            accommodation: booking.amounts.accommodation,
            cleaning: booking.amounts.cleaning,
            commission: booking.amounts.commission,
            refunds: booking.amounts.refund,
            taxCollected: booking.amounts.touristTaxCollected,
            taxRemitted: booking.amounts.touristTaxRemitted,
          }),
        ]),
      ),
      knownPayoutIds: new Set(first.payouts.map((payout) => payout.externalPayoutId)),
    };
    const second = planBookingsCsv(BOOKINGS_CSV, context);
    expect(newBookings(second)).toEqual([]);
    expect(newPayouts(second)).toEqual([]);
    expect(second.bookings.every((booking) => booking.duplicateReason === "already_imported")).toBe(
      true,
    );
    expect(second.blocked).toBe(false);
  });

  it("marks the second occurrence of an identifier inside one file", () => {
    const csv = BOOKINGS_CSV.trimEnd()
      .split("\n")
      .concat([
        "HMABC1;Studio Vue Mer;14/07/2026;19/07/2026;Doublon;2;820,00;70,00;26,70;0,00;24,00;24,00;EUR;PAY-2026-07;25/07/2026;1309,50",
      ])
      .join("\n");
    const plan = planBookingsCsv(csv);
    expect(plan.bookings.filter((booking) => booking.duplicate)).toHaveLength(1);
    expect(plan.bookings.at(-1)?.duplicateReason).toBe("duplicate_in_file");
    expect(newBookings(plan)).toHaveLength(2);
  });
});

describe("AIR-02 — grouped payout", () => {
  it("settles several stays in one transfer and keeps the refund out of the revenue", () => {
    const plan = planBookingsCsv(BOOKINGS_CSV);
    expect(plan.payouts).toHaveLength(1);
    const payout = plan.payouts[0];
    expect(payout?.externalPayoutId).toBe("PAY-2026-07");
    expect(payout?.paidOn).toBe("2026-07-25");
    expect(payout?.bookingReferences).toEqual(["HMABC1", "HMABC2"]);
    expect(payout?.reconciliation).toMatchObject({
      declaredNet: "1309.50",
      bookingNet: "1309.50",
      expectedNet: "1309.50",
      difference: "0.00",
      matched: true,
      grossServices: "1500.00",
      refunds: "150.00",
      commissions: "40.50",
      taxFlow: "0.00",
      revenueRecognised: "1350.00",
    });
    expect(payout?.reconciliation.lines.map((line) => [line.reference, line.net])).toEqual([
      ["HMABC1", "863.30"],
      ["HMABC2", "446.20"],
    ]);
  });

  it("reconstructs a transfer that carries a retention of another period", () => {
    const context: PlanContext = {
      knownBookings: new Map([
        [
          "HMABC1",
          knownFrom("HMABC1", {
            accommodation: "820.00",
            cleaning: "70.00",
            commission: "26.70",
            taxCollected: "24.00",
            taxRemitted: "24.00",
          }),
        ],
        [
          "HMABC2",
          knownFrom("HMABC2", {
            accommodation: "540.00",
            cleaning: "70.00",
            commission: "13.80",
            refunds: "150.00",
            taxCollected: "16.00",
            taxRemitted: "16.00",
          }),
        ],
      ]),
      knownPayoutIds: new Set(),
    };
    const plan = planImport({
      mapping: resolveMapping("generic-payouts-iso-v1"),
      table: parseCsv(PAYOUTS_CSV),
      context,
    });
    expect(plan.issues).toEqual([]);
    const reconciliation = plan.payouts[0]?.reconciliation;
    expect(reconciliation).toMatchObject({
      bookingNet: "1309.50",
      adjustmentTotal: "-45.00",
      expectedNet: "1264.50",
      declaredNet: "1264.50",
      difference: "0.00",
      matched: true,
    });
    expect(reconciliation?.adjustments).toEqual([
      {
        reference: "Retenue, période précédente",
        kind: "retention",
        amount: "-45.00",
        label: "Retenue, période précédente",
      },
    ]);
    expect(reconciliation?.lines.every((line) => line.known)).toBe(true);
  });

  it("shows the difference and the unknown booking rather than forcing a balance", () => {
    const plan = planImport({
      mapping: resolveMapping("generic-payouts-iso-v1"),
      table: parseCsv(PAYOUTS_CSV),
      context: emptyContext(),
    });
    const reconciliation = plan.payouts[0]?.reconciliation;
    expect(reconciliation?.bookingNet).toBe("0.00");
    expect(reconciliation?.expectedNet).toBe("-45.00");
    expect(reconciliation?.difference).toBe("1309.50");
    expect(reconciliation?.matched).toBe(false);
    expect(reconciliation?.unexplained.map((entry) => entry.reference)).toEqual([
      "HMABC1",
      "HMABC2",
    ]);
  });
});

describe("AIR-02 — total check", () => {
  it("accepts a declared total equal to the sum of the file", () => {
    const plan = planBookingsCsv(BOOKINGS_CSV, {
      ...emptyContext(),
      declaredTotal: "1309.50",
    });
    expect(plan.totals).toEqual({
      declared: "1309.50",
      computed: "1309.50",
      difference: "0.00",
      matched: true,
    });
    expect(plan.blocked).toBe(false);
  });

  it("blocks a truncated file whose total no longer matches", () => {
    const truncated = BOOKINGS_CSV.split("\n").slice(0, 2).join("\n");
    const plan = planBookingsCsv(truncated, { ...emptyContext(), declaredTotal: "1309.50" });
    expect(plan.totals.computed).toBe("863.30");
    expect(plan.totals.difference).toBe("446.20");
    expect(plan.blockedReasons).toContain("total_mismatch");
  });
});
