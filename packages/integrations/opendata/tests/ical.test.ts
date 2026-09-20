import { describe, expect, it } from "vitest";
import {
  blocksOverlapping,
  fetchIcal,
  icalAvailability,
  nightsBetween,
  parseIcal,
} from "../src/ical";

const FEED = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Airbnb Inc//Hosting Calendar 1.0.0//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260714",
  "DTEND;VALUE=DATE:20260719",
  "UID:hm-all-day@airbnb.com",
  "SUMMARY:Réservé (HMABC1)",
  "DTSTAMP:20260701T090000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Paris:20260801T160000",
  "DTEND;TZID=Europe/Paris:20260804T110000",
  "UID:hm-tzid@airbnb.com",
  "SUMMARY:Séjour avec arrivée 16h\\, départ 11h",
  "LAST-MODIFIED:20260720T221500Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20260901T230000Z",
  "DTEND:20260903T080000Z",
  "UID:hm-utc@airbnb.com",
  "SUMMARY:Bloc saisi en UTC",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261001",
  "DTEND;VALUE=DATE:20261005",
  "UID:hm-cancelled@airbnb.com",
  "STATUS:CANCELLED",
  "SUMMARY:Annulé",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261101",
  "DTEND;VALUE=DATE:20261103",
  "UID:hm-transparent@airbnb.com",
  "TRANSP:TRANSPARENT",
  "SUMMARY:Note d’agenda",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("AIR-03 — iCal feed", () => {
  it("reads an all-day event as nights, the departure day excluded", () => {
    const calendar = parseIcal(FEED);
    const event = calendar.events.find((candidate) => candidate.uid === "hm-all-day@airbnb.com");
    expect(event).toMatchObject({
      startsOn: "2026-07-14",
      endsOn: "2026-07-18",
      allDay: true,
      blocking: true,
    });
    expect(nightsBetween("2026-07-14", "2026-07-18")).toBe(5);
  });

  it("keeps the civil dates of a TZID event and unescapes its summary", () => {
    const calendar = parseIcal(FEED);
    const event = calendar.events.find((candidate) => candidate.uid === "hm-tzid@airbnb.com");
    expect(event?.startsOn).toBe("2026-08-01");
    expect(event?.endsOn).toBe("2026-08-03");
    expect(event?.allDay).toBe(false);
    expect(event?.summary).toBe("Séjour avec arrivée 16h, départ 11h");
    expect(event?.lastModifiedAt).toBe("2026-07-20T22:15:00.000Z");
  });

  it("moves a UTC instant into the reading zone", () => {
    const paris = parseIcal(FEED);
    const utc = parseIcal(FEED, { timeZone: "UTC" });
    const inParis = paris.events.find((candidate) => candidate.uid === "hm-utc@airbnb.com");
    const inUtc = utc.events.find((candidate) => candidate.uid === "hm-utc@airbnb.com");
    expect(inParis?.startsOn).toBe("2026-09-02");
    expect(inUtc?.startsOn).toBe("2026-09-01");
  });

  it("drops cancelled and transparent events from availability", () => {
    const blocks = icalAvailability(parseIcal(FEED));
    expect(blocks.map((block) => block.uid)).toEqual([
      "hm-all-day@airbnb.com",
      "hm-tzid@airbnb.com",
      "hm-utc@airbnb.com",
    ]);
    expect(blocks[0]?.nights).toBe(5);
  });

  it("unfolds folded lines and ignores an event without a UID", () => {
    const folded = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:folded@airbnb.com",
      "SUMMARY:Un titre vraiment très long qui a ét",
      " é replié par la plateforme",
      "DTSTART;VALUE=DATE:20260201",
      "DTEND;VALUE=DATE:20260203",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260301",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const calendar = parseIcal(folded);
    expect(calendar.events).toHaveLength(1);
    expect(calendar.events[0]?.summary).toBe(
      "Un titre vraiment très long qui a été replié par la plateforme",
    );
    expect(calendar.skipped).toEqual([{ uid: null, reason: "uid_missing" }]);
  });

  it("selects the blocks overlapping a window", () => {
    const blocks = icalAvailability(parseIcal(FEED));
    const july = blocksOverlapping(blocks, { from: "2026-07-01", to: "2026-07-31" });
    expect(july.map((block) => block.uid)).toEqual(["hm-all-day@airbnb.com"]);
  });

  it("fetches through the injected fetch and refuses a non-http address", async () => {
    const calls: string[] = [];
    const body = await fetchIcal({
      url: "https://calendar.example.test/feed.ics",
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(FEED, { status: 200 });
      },
    });
    expect(calls).toEqual(["https://calendar.example.test/feed.ics"]);
    expect(parseIcal(body).events).toHaveLength(5);
    await expect(
      fetchIcal({
        url: "file:///etc/passwd",
        fetch: async () => new Response("", { status: 200 }),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("maps an upstream failure instead of returning an empty calendar", async () => {
    await expect(
      fetchIcal({
        url: "https://calendar.example.test/feed.ics",
        fetch: async () => new Response("nope", { status: 503 }),
      }),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
