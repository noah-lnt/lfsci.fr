import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileTypst, DATA_FILENAME, writeTypstJob } from "../src/compile";
import type { DecompteData, QuittanceData, RecuData } from "../src/schema";

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
  lignes: [
    {
      libelle: "Eau froide",
      montantTotal: "1200.00",
      cle: "tantièmes 120/1000",
      quotePart: "144.00",
    },
    {
      libelle: "Entretien parties communes",
      montantTotal: "900.00",
      cle: "tantièmes 120/1000",
      quotePart: "108.00",
    },
  ],
  totalCharges: "252.00",
  provisionsVersees: "240.00",
  solde: "12.00",
  libelleSolde: "Solde restant dû par le locataire",
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
    expect(JSON.parse(await readFile(decompteJob.dataPath, "utf8")).lignes).toHaveLength(2);
  });
});

describe.skipIf(!hasTypst)(
  `typst compilation${hasTypst ? "" : ` — SKIPPED: ${SKIP_REASON}`}`,
  () => {
    it("renders each template to a PDF", async () => {
      for (const [template, data] of [
        ["quittance", quittance],
        ["recu", recu],
        ["decompte", decompte],
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
