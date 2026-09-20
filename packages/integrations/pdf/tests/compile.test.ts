import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileTypst, DATA_FILENAME, writeTypstJob } from "../src/compile";
import type { DecompteData, QuittanceData, RecuData, RevisionData } from "../src/schema";

const base = {
  sci: { nom: "SCI Exemple", adresse: "1 rue des Tests, 64000 Pau", siret: "00000000000000" },
  locataire: { nom: "Camille Martin", adresse: "12 rue du Lot, 64230 Lescar" },
  lot: { designation: "Appartement T3, lot 4", adresse: "12 rue du Lot, 64230 Lescar" },
  periode: { debut: "01/09/2026", fin: "30/09/2026" },
  lieu: "Pau",
  dateEdition: "01/10/2026",
  signataire: "Le gérant",
};

const quittance: QuittanceData = {
  ...base,
  loyer: "850.00",
  provisions: "60.00",
  total: "910.00",
  datePaiement: "03/09/2026",
};

const recu: RecuData = {
  ...base,
  total: "910.00",
  montantRecu: "400.00",
  resteDu: "510.00",
  datePaiement: "03/09/2026",
  modePaiement: "virement",
};

const decompte: DecompteData = {
  ...base,
  exercice: "2026",
  occupation: { debut: "01/01/2026", fin: "30/06/2026", jours: 181, joursPeriode: 365 },
  lignes: [
    {
      libelle: "Eau froide",
      montantTotal: "1200.00",
      cle: "tantièmes 120/1000 (version 2)",
      quotePart: "144.00",
    },
    {
      libelle: "Entretien parties communes",
      montantTotal: "900.00",
      cle: "tantièmes 120/1000 (version 2)",
      quotePart: "108.00",
    },
  ],
  totalCharges: "252.00",
  provisionsAppelees: "240.00",
  provisionsPayees: "180.00",
  provisionsImpayees: "60.00",
  solde: "12.00",
  libelleSolde: "Solde restant dû par le locataire",
};

const revision: RevisionData = {
  ...base,
  indice: "IRL",
  trimestreReference: "2e trimestre",
  ancienIndice: "143.46",
  nouvelIndice: "146.12",
  loyerActuel: "800.00",
  loyerRevise: "814.83",
  loyerReviseNonArrondi: "814.833403",
  variation: "14.83",
  chargesProvision: "60.00",
  dateEffet: "01/10/2026",
  clause: "article 5 du bail",
  source: "INSEE",
};

function typstAvailable(): boolean {
  try {
    execFileSync("which", ["typst"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasTypst = typstAvailable();
const SKIP_REASON =
  "typst is not on PATH: install it to render the templates; only the job contract is asserted";

let workDir = "";
beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "lfsci-pdf-"));
  if (!hasTypst) console.warn(SKIP_REASON);
});
afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("typst job contract", () => {
  it("writes data.json and the template beside it", async () => {
    const job = await writeTypstJob({ template: "quittance", data: quittance, tmpDir: workDir });
    expect(job.dataPath.endsWith(DATA_FILENAME)).toBe(true);
    expect(JSON.parse(await readFile(job.dataPath, "utf8"))).toEqual(quittance);
    const source = await readFile(job.templatePath, "utf8");
    expect(source).toContain("QUITTANCE DE LOYER");
    expect(source).toContain('sys.inputs.at("data"');
    expect(await readFile(join(job.dir, "common.typ"), "utf8")).toContain("#let euro");
  });

  it("keeps the header printable when the SCI has no registered office yet", async () => {
    const { adresse, ...sci } = base.sci;
    const withoutAddress: QuittanceData = { ...quittance, sci };
    const job = await writeTypstJob({
      template: "quittance",
      data: withoutAddress,
      tmpDir: workDir,
    });
    expect(JSON.parse(await readFile(job.dataPath, "utf8")).sci.adresse).toBeUndefined();
    // The schema marks the address optional, so the header may only read it guarded.
    const common = await readFile(join(job.dir, "common.typ"), "utf8");
    expect(common).toContain('#if "adresse" in data.sci');
    expect(common).not.toContain("\n      #data.sci.adresse");
  });

  it("refuses data that does not match the template schema", async () => {
    await expect(
      writeTypstJob({
        template: "quittance",
        data: { ...quittance, loyer: "huit cent cinquante" },
        tmpDir: workDir,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("carries the décompte lines and the reçu partial amounts into data.json", async () => {
    const recuJob = await writeTypstJob({ template: "recu", data: recu, tmpDir: workDir });
    expect(JSON.parse(await readFile(recuJob.dataPath, "utf8")).resteDu).toBe("510.00");
    const decompteJob = await writeTypstJob({
      template: "decompte",
      data: decompte,
      tmpDir: workDir,
    });
    const decompteData = JSON.parse(await readFile(decompteJob.dataPath, "utf8"));
    expect(decompteData.lignes).toHaveLength(2);
    // CHA-02: unpaid provisions travel to the statement as their own figure.
    expect(decompteData.provisionsImpayees).toBe("60.00");
    expect(decompteData.occupation.jours).toBe(181);
  });

  it("carries the revision letter's exact index values", async () => {
    const job = await writeTypstJob({ template: "revision", data: revision, tmpDir: workDir });
    const written = JSON.parse(await readFile(job.dataPath, "utf8"));
    expect(written.loyerReviseNonArrondi).toBe("814.833403");
    expect(written.ancienIndice).toBe("143.46");
    const source = await readFile(job.templatePath, "utf8");
    expect(source).toContain("RÉVISION ANNUELLE DU LOYER");
    expect(source).toContain("n'est pas rétroactive");
  });
});

describe.skipIf(!hasTypst)(
  `typst compilation${hasTypst ? "" : ` — SKIPPED: ${SKIP_REASON}`}`,
  () => {
    it("renders the header of an SCI that has no address", async () => {
      const { adresse, ...sci } = base.sci;
      const pdf = await compileTypst({
        template: "quittance",
        data: { ...quittance, sci },
        tmpDir: workDir,
      });
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    });

    it("renders each template to a PDF", async () => {
      for (const [template, data] of [
        ["quittance", quittance],
        ["recu", recu],
        ["decompte", decompte],
        ["revision", revision],
      ] as const) {
        const pdf = await compileTypst({ template, data, tmpDir: workDir });
        expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
      }
    });

    it("maps a missing binary to INTERNAL", async () => {
      await expect(
        compileTypst({
          template: "quittance",
          data: quittance,
          tmpDir: workDir,
          typstBinary: "typst-absent",
        }),
      ).rejects.toMatchObject({ code: "INTERNAL" });
    });
  },
);
