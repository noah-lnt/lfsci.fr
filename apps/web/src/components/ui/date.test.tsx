import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateValue, formatDate } from "./date";
import { EMPTY } from "./money";

describe("formatDate", () => {
  it("formats a civil date without shifting it across a timezone", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });

  it("formats an instant in Europe/Paris", () => {
    expect(formatDate("2026-07-14T22:30:00Z", true)).toBe("15/07/2026 00:30");
  });

  it("returns the dash on an unparsable value", () => {
    expect(formatDate("not-a-date")).toBe(EMPTY);
  });
});

describe("<DateValue />", () => {
  it("renders a machine-readable time element", () => {
    const html = renderToStaticMarkup(<DateValue value="2026-01-01" />);
    expect(html.toLowerCase()).toContain('datetime="2026-01-01"');
  });

  it("renders a dash for absent data", () => {
    expect(renderToStaticMarkup(<DateValue value={null} />)).toContain(EMPTY);
  });
});
