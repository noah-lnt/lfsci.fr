/**
 * AIR-03: an iCal feed is a calendar, never financial evidence. Nothing in this
 * module reads or produces an amount, and the platforms refresh imported
 * calendars on their own schedule, so a block read here can already be stale.
 */
import { AppError } from "@lfsci/kernel";
import { type FetchLike, mapHttpFailure, mapTransportFailure, readBody } from "./http";

export const DEFAULT_ICAL_TIME_ZONE = "Europe/Paris";

export type IcalEventStatus = "confirmed" | "tentative" | "cancelled" | "unknown";

export type IcalEvent = {
  uid: string;
  summary: string | null;
  /** First occupied night, as a civil date. */
  startsOn: string;
  /** Last occupied night: DTEND is exclusive, a departure day is not a night. */
  endsOn: string;
  allDay: boolean;
  status: IcalEventStatus;
  /** An opaque, non-cancelled event is what makes the unit unavailable. */
  blocking: boolean;
  lastModifiedAt: string | null;
};

export type IcalCalendar = {
  productId: string | null;
  timeZone: string;
  events: IcalEvent[];
  /** Entries the parser refused, kept visible instead of silently dropped. */
  skipped: { uid: string | null; reason: string }[];
};

export type AvailabilityBlock = {
  uid: string;
  startsOn: string;
  endsOn: string;
  nights: number;
  label: string | null;
  source: "ical";
};

type ContentLine = { name: string; params: Map<string, string>; value: string };

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const DURATION = /^-?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function unfold(text: string): string[] {
  const raw = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if (line === "") continue;
    const continuation = line.startsWith(" ") || line.startsWith("\t");
    const previous = lines.length > 0 ? lines[lines.length - 1] : undefined;
    if (continuation && previous !== undefined) {
      lines[lines.length - 1] = previous + line.slice(1);
      continue;
    }
    lines.push(line);
  }
  return lines;
}

function splitOutsideQuotes(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === separator && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function parseLine(line: string): ContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon <= 0) return null;
  const [rawName, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");
  if (rawName === undefined || rawName === "") return null;
  const params = new Map<string, string>();
  for (const param of rawParams) {
    const equals = param.indexOf("=");
    if (equals <= 0) continue;
    params.set(param.slice(0, equals).toUpperCase(), param.slice(equals + 1));
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );
}

function civilDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nightsBetween(startsOn: string, endsOn: string): number {
  const from = Date.parse(`${startsOn}T12:00:00Z`);
  const to = Date.parse(`${endsOn}T12:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

type IcalMoment = { date: string; allDay: boolean; instant: Date | null };

/**
 * A TZID or floating value keeps its own civil date: a calendar block is a
 * civil date, and re-anchoring it on another zone would move a night for no
 * gain. Only a UTC instant is converted, into the reading zone.
 */
function parseMoment(line: ContentLine, timeZone: string): IcalMoment | null {
  const value = line.value.trim();
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return { date: `${year}-${month}-${day}`, allDay: true, instant: null };
  }
  const dateTime = DATE_TIME.exec(value);
  if (!dateTime) return null;
  const [, year, month, day, hour, minute, second, zulu] = dateTime;
  if (zulu === "Z") {
    const instant = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
      ),
    );
    return { date: civilDateInZone(instant, timeZone), allDay: false, instant };
  }
  return { date: `${year}-${month}-${day}`, allDay: false, instant: null };
}

function durationDays(value: string): number | null {
  const match = DURATION.exec(value.trim());
  if (!match) return null;
  const [, weeks, days, hours, minutes] = match;
  const total =
    Number(weeks ?? 0) * 7 +
    Number(days ?? 0) +
    (Number(hours ?? 0) > 0 || Number(minutes ?? 0) > 0 ? 1 : 0);
  return total > 0 ? total : null;
}

function statusOf(value: string | undefined): IcalEventStatus {
  switch ((value ?? "").toUpperCase()) {
    case "CONFIRMED":
      return "confirmed";
    case "TENTATIVE":
      return "tentative";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}

export function parseIcal(text: string, options?: { timeZone?: string }): IcalCalendar {
  const timeZone = options?.timeZone ?? DEFAULT_ICAL_TIME_ZONE;
  const events: IcalEvent[] = [];
  const skipped: { uid: string | null; reason: string }[] = [];
  let productId: string | null = null;
  let current: Map<string, ContentLine> | null = null;

  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN" && line.value.toUpperCase() === "VEVENT") {
      current = new Map();
      continue;
    }
    if (line.name === "END" && line.value.toUpperCase() === "VEVENT") {
      if (current) {
        const event = buildEvent(current, timeZone, skipped);
        if (event) events.push(event);
      }
      current = null;
      continue;
    }
    if (current) {
      if (!current.has(line.name)) current.set(line.name, line);
      continue;
    }
    if (line.name === "PRODID") productId = unescapeText(line.value);
  }

  events.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.uid.localeCompare(b.uid));
  return { productId, timeZone, events, skipped };
}

function buildEvent(
  fields: Map<string, ContentLine>,
  timeZone: string,
  skipped: { uid: string | null; reason: string }[],
): IcalEvent | null {
  const uid = fields.get("UID")?.value.trim() ?? null;
  const dtStartLine = fields.get("DTSTART");
  if (!uid) {
    skipped.push({ uid: null, reason: "uid_missing" });
    return null;
  }
  if (!dtStartLine) {
    skipped.push({ uid, reason: "dtstart_missing" });
    return null;
  }
  const start = parseMoment(dtStartLine, timeZone);
  if (!start) {
    skipped.push({ uid, reason: "dtstart_unreadable" });
    return null;
  }

  const dtEndLine = fields.get("DTEND");
  const end = dtEndLine ? parseMoment(dtEndLine, timeZone) : null;
  let endsOn: string;
  if (end) {
    endsOn = addDays(end.date, -1);
  } else {
    const days = durationDays(fields.get("DURATION")?.value ?? "");
    endsOn = days === null ? start.date : addDays(start.date, days - 1);
  }
  if (endsOn < start.date) endsOn = start.date;

  const status = statusOf(fields.get("STATUS")?.value.trim());
  const transparent = (fields.get("TRANSP")?.value.trim() ?? "").toUpperCase() === "TRANSPARENT";
  const stamp = fields.get("LAST-MODIFIED") ?? fields.get("DTSTAMP");
  const stampMoment = stamp ? parseMoment(stamp, timeZone) : null;
  const summary = fields.get("SUMMARY")?.value;

  return {
    uid,
    summary: summary === undefined || summary === "" ? null : unescapeText(summary),
    startsOn: start.date,
    endsOn,
    allDay: start.allDay,
    status,
    blocking: status !== "cancelled" && !transparent,
    lastModifiedAt: stampMoment?.instant ? stampMoment.instant.toISOString() : null,
  };
}

/** The blocked nights a feed announces — availability only, never a figure. */
export function icalAvailability(calendar: IcalCalendar): AvailabilityBlock[] {
  return calendar.events
    .filter((event) => event.blocking)
    .map((event) => ({
      uid: event.uid,
      startsOn: event.startsOn,
      endsOn: event.endsOn,
      nights: nightsBetween(event.startsOn, event.endsOn),
      label: event.summary,
      source: "ical" as const,
    }));
}

export function blocksOverlapping(
  blocks: readonly AvailabilityBlock[],
  range: { from: string; to: string },
): AvailabilityBlock[] {
  return blocks.filter((block) => block.startsOn <= range.to && block.endsOn >= range.from);
}

const MAX_ICAL_BYTES = 2_000_000;

export async function fetchIcal(input: {
  url: string;
  fetch: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch (cause) {
    throw new AppError("VALIDATION", {
      message: "Adresse de calendrier invalide.",
      details: { service: "ical" },
      cause,
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppError("VALIDATION", {
      message: "Adresse de calendrier invalide.",
      details: { service: "ical", protocol: parsed.protocol },
    });
  }

  let response: Response;
  try {
    response = await input.fetch(parsed.toString(), {
      method: "GET",
      headers: { accept: "text/calendar, text/plain;q=0.8" },
      signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
    });
  } catch (cause) {
    throw mapTransportFailure({ service: "ical", idempotent: true, cause });
  }
  if (!response.ok) {
    throw mapHttpFailure({
      service: "ical",
      status: response.status,
      body: await readBody(response),
    });
  }
  const body = await response.text();
  const limit = input.maxBytes ?? MAX_ICAL_BYTES;
  if (body.length > limit) {
    throw new AppError("PAYLOAD_TOO_LARGE", { details: { service: "ical", limit } });
  }
  return body;
}
