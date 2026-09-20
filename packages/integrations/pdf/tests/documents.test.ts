import { describe, expect, it } from "vitest";
import { buildDecompteData, buildRevisionData, frDate } from "../src/documents";

const party = {
  sci: { nom: "SCI Exemple", adresse: "1 rue des Tests, 64000 Pau", siret: "00000000000000" },
  locataire: { nom: "Camille Martin" },
  lot: { designation: "Appartement T3, lot 4", adresse: "12 rue du Lot, 64230 Lescar" },
  lieu: "Pau",
  signataire: "Le gérant",
  issuedOn: "2027-02-15",
};

const labels = {
  directKey: "Affectation directe au lot",
  owes: "Solde restant dû par le locataire",
  credit: "Trop-perçu à restituer au locataire",
  settled: "Compte équilibré",
};

const decompte = {
  ...party,
  periodStart: "2026-01-01",
  periodEnd: "2026-12-31",
  occupancyStart: "2026-01-01",
  occupancyEnd: "2026-06-30",
  occupancyDays: 181,
  periodDays: 365,
  postings: [
    {
      label: "Eau froide",
      recoverableAmount: "1200.00",
      keyLabel: "Tantièmes (version 2)",
      quotePart: "297.53",
    },
    {
      label: "Entretien chaudière",
      recoverableAmount: "93.00",
      keyLabel: null,
      quotePart: "93.00",
    },
  ],
  totalCharges: "390.53",
  provisionsAppelees: "360.00",
  provisionsPayees: "300.00",
  provisionsImpayees: "60.00",
  balance: "30.53",
  labels,
};

describe("CHA-02 — the statement carries what the run froze", () => {
  it("renders French dates and names the tenant's debit", () => {
    const data = buildDecompteData(decompte);
    expect(data.periode).toEqual({ debut: "01/01/2026", fin: "31/12/2026" });
    expect(data.dateEdition).toBe("15/02/2027");
    expect(data.exercice).toBe("2026");
    expect(data.occupation).toEqual({
      debut: "01/01/2026",
      fin: "30/06/2026",
      jours: 181,
      joursPeriode: 365,
    });
    expect(data.solde).toBe("30.53");
    expect(data.libelleSolde).toBe(labels.owes);
    // A lot-targeted charge says so instead of naming a key.
    expect(data.lignes[1]?.cle).toBe(labels.directKey);
    // The unpaid provisions travel as their own figure, never folded into the balance.
    expect(data.provisionsImpayees).toBe("60.00");
  });

  it("shows an overpayment as a positive amount with the credit wording", () => {
    const data = buildDecompteData({ ...decompte, balance: "-42.10" });
    expect(data.solde).toBe("42.10");
    expect(data.libelleSolde).toBe(labels.credit);
    expect(buildDecompteData({ ...decompte, balance: "0.00" }).libelleSolde).toBe(labels.settled);
  });

  it("refuses an amount the template cannot print", () => {
    expect(() =>
      buildDecompteData({ ...decompte, totalCharges: "trois cent quatre-vingt-dix" }),
    ).toThrow();
  });
});

describe("IRL-01 — the notification letter", () => {
  it("keeps the exact index values and the unrounded rent", () => {
    const data = buildRevisionData({
      ...party,
      periodStart: "2026-10-01",
      periodEnd: "2027-09-30",
      indexLabel: "IRL",
      referenceQuarter: "2e trimestre",
      previousIndexValue: "143.46",
      newIndexValue: "146.12",
      baseRent: "800.00",
      proposedRent: "814.83",
      computedRentUnrounded: "814.833403",
      variation: "14.83",
      chargeAmount: "60.00",
      effectiveOn: "2026-10-01",
      clause: "article 5 du bail",
      source: "INSEE",
    });
    expect(data.ancienIndice).toBe("143.46");
    expect(data.loyerReviseNonArrondi).toBe("814.833403");
    expect(data.variation).toBe("14.83");
    expect(data.dateEffet).toBe("01/10/2026");
  });
});

describe("frDate", () => {
  it("leaves an already formatted date untouched", () => {
    expect(frDate("01/10/2026")).toBe("01/10/2026");
    expect(frDate("2026-10-01")).toBe("01/10/2026");
  });
});
