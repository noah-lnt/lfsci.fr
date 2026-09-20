import { arrearsDetect } from "./arrearsDetect";
import { controlsNightly } from "./controlsNightly";
import { deadlinesGenerate } from "./deadlinesGenerate";
import { documentAnalyze } from "./documentAnalyze";
import { emailDispatch } from "./emailDispatch";
import { icalPoll } from "./icalPoll";
import { inboundEmail } from "./inboundEmail";
import { irlRefresh } from "./irlRefresh";
import { odooBacksync } from "./odooBacksync";
import { outboxDispatch } from "./outboxDispatch";
import { outboxReconcile } from "./outboxReconcile";
import { pdfRender } from "./pdfRender";
import type { AnyJob } from "./registry";
import { rentPrepareTerms } from "./rentPrepareTerms";
import { retentionPurge } from "./retentionPurge";
import { searchIndex } from "./searchIndex";
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
  retentionPurge,
  searchIndex,
  arrearsDetect,
  emailDispatch,
  icalPoll,
];

export const jobNames = jobs.map((job) => job.name);
