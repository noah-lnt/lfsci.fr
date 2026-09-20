import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY, Money, formatMoney } from "./money";

const normalise = (value: string) => value.replace(/[  ]/g, " ");

describe("formatMoney", () => {
  it("formats a decimal string as French euros with two decimals", () => {
    expect(normalise(formatMoney("1234.5"))).toBe("1 234,50 €");
  });

  it("keeps the sign of a negative amount", () => {
    expect(normalise(formatMoney("-90"))).toBe("-90,00 €");
  });

  it("honours another currency", () => {
    expect(normalise(formatMoney("10", "CHF"))).toContain("CHF");
  });

  it("returns the dash rather than NaN on a non-numeric string", () => {
    expect(formatMoney("abc")).toBe(EMPTY);
  });
});

describe("<Money />", () => {
  it("renders tabular figures", () => {
    expect(renderToStaticMarkup(<Money amount="1000" />)).toContain('class="num"');
  });

  it("renders a dash for absent data, never a zero", () => {
    const html = renderToStaticMarkup(<Money amount={null} />);
    expect(normalise(html)).toContain(EMPTY);
    expect(html).not.toContain("0,00");
  });
});
