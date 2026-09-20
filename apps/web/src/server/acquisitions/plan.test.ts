import { describe, expect, it } from "vitest";
import { type ConversionState, planConversion } from "./plan";

const BUILDING = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const COMMAND = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

const pending: ConversionState = {
  status: "signed",
  version: 3,
  convertedBuildingId: null,
  conversionCommandId: null,
};

const converted: ConversionState = {
  status: "converted",
  version: 4,
  convertedBuildingId: BUILDING,
  conversionCommandId: COMMAND,
};

describe("ACQ-01 — the conversion runs once", () => {
  it("converts an opportunity that carries no conversion command", () => {
    expect(planConversion(pending, { loanAmount: "200000.00" })).toEqual({
      kind: "convert",
      createLoan: true,
    });
  });

  it("returns the first conversion's objects instead of creating new ones", () => {
    expect(planConversion(converted, { loanAmount: "200000.00" })).toEqual({
      kind: "already_converted",
      buildingId: BUILDING,
      commandId: COMMAND,
    });
  });

  it("is a no-op whatever the scenario says once converted", () => {
    expect(planConversion(converted, undefined)).toEqual(
      planConversion(converted, { loanAmount: "1.00" }),
    );
  });

  it("prepares no loan when the base scenario borrows nothing", () => {
    expect(planConversion(pending, { loanAmount: "0.00" })).toEqual({
      kind: "convert",
      createLoan: false,
    });
    expect(planConversion(pending, undefined)).toEqual({ kind: "convert", createLoan: false });
  });

  it("still converts when a half-written state has a building but no command", () => {
    expect(planConversion({ ...pending, convertedBuildingId: BUILDING }, undefined).kind).toBe(
      "convert",
    );
  });
});
