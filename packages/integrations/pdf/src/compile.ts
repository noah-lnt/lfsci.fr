import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { AppError, logger } from "@lfsci/kernel";
import { type TemplateData, type TemplateName, templateSchemas } from "./schema";

const run = promisify(execFile);
const log = logger("typst");

export const TYPST_TIMEOUT_MS = 20_000;
export const DATA_FILENAME = "data.json";
export const TEMPLATE_FILENAME = "template.typ";
export const OUTPUT_FILENAME = "out.pdf";

export function templatePath(template: TemplateName): string {
  return fileURLToPath(new URL(`./templates/${template}.typ`, import.meta.url));
}

export type TypstJob = { dir: string; dataPath: string; templatePath: string; outputPath: string };

export async function writeTypstJob<T extends TemplateName>(input: {
  template: T;
  data: TemplateData[T];
  tmpDir: string;
}): Promise<TypstJob> {
  const schema = templateSchemas[input.template];
  const parsed = schema.safeParse(input.data);
  if (!parsed.success) {
    throw new AppError("VALIDATION", {
      message: `invalid ${input.template} data`,
      details: { issues: parsed.error.issues.map((i) => i.path.join(".")) },
    });
  }

  const dir = await mkdtemp(join(input.tmpDir, `typst-${input.template}-`));
  const dataPath = join(dir, DATA_FILENAME);
  const copiedTemplate = join(dir, TEMPLATE_FILENAME);
  await writeFile(dataPath, JSON.stringify(parsed.data, null, 2), "utf8");
  await copyFile(templatePath(input.template), copiedTemplate);
  await copyFile(
    fileURLToPath(new URL("./templates/common.typ", import.meta.url)),
    join(dir, "common.typ"),
  );
  return { dir, dataPath, templatePath: copiedTemplate, outputPath: join(dir, OUTPUT_FILENAME) };
}

export async function compileTypst<T extends TemplateName>(input: {
  template: T;
  data: TemplateData[T];
  tmpDir: string;
  typstBinary?: string;
  keepArtifacts?: boolean;
}): Promise<Uint8Array> {
  const job = await writeTypstJob(input);
  const binary = input.typstBinary ?? "typst";
  try {
    await run(
      binary,
      ["compile", "--input", `data=${DATA_FILENAME}`, TEMPLATE_FILENAME, OUTPUT_FILENAME],
      { cwd: job.dir, timeout: TYPST_TIMEOUT_MS, killSignal: "SIGKILL" },
    );
    const pdf = await readFile(job.outputPath);
    log.debug({ template: input.template, bytes: pdf.byteLength }, "pdf compiled");
    return new Uint8Array(pdf);
  } catch (cause) {
    const stderr = cause instanceof Error && "stderr" in cause ? String(cause.stderr) : "";
    throw new AppError("INTERNAL", {
      message: `typst failed to compile ${input.template}`,
      details: { template: input.template, stderr: stderr.slice(0, 1024) },
      cause,
    });
  } finally {
    if (!input.keepArtifacts) await rm(job.dir, { recursive: true, force: true });
  }
}
