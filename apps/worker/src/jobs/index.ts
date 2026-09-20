import { controlsNightly } from "./controlsNightly";
import { deadlinesGenerate } from "./deadlinesGenerate";
import { documentAnalyze } from "./documentAnalyze";
import { inboundEmail } from "./inboundEmail";
import { irlRefresh } from "./irlRefresh";
import { odooBacksync } from "./odooBacksync";
import { outboxDispatch } from "./outboxDispatch";
import { outboxReconcile } from "./outboxReconcile";
import { pdfRender } from "./pdfRender";
import type { AnyJob } from "./registry";
import { rentPrepareTerms } from "./rentPrepareTerms";
import { voiceTranscribe } from "./voiceTranscribe";

export const jobs: readonly AnyJob[] = [
  outboxDispatch,
  outboxReconcile,
  documentAnalyze,
  inboundEmail,
  voiceTranscribe,
  rentPrepareTerms,
  controlsNightly,
  deadlinesGenerate,
  odooBacksync,
  pdfRender,
  irlRefresh,
];

export const jobNames = jobs.map((job) => job.name);
