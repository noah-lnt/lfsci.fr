import { describe, expect, it } from "vitest";
import { CreateUploadInput } from "../src/api/documents";
import {
  CaptureExpenseInput,
  CreateBuildingInput,
  CreateLeaseInput,
  CreateMeterReadingInput,
  CreatePersonInput,
  InboxDecisionInput,
  InboxIntent,
  UpdateLeaseInput,
} from "../src/entities";
import {
  captureExpenseInputFixture,
  createBuildingInputFixture,
  createLeaseInputFixture,
  createMeterReadingInputFixture,
  createPersonInputFixture,
  inboxDecisionInputFixture,
  inboxIntentFixture,
  sha256Fixture,
  updateLeaseInputFixture,
} from "../src/fixtures";

const strictCases = [
  ["CreateBuildingInput", CreateBuildingInput, createBuildingInputFixture],
  ["CreatePersonInput", CreatePersonInput, createPersonInputFixture],
  ["CreateLeaseInput", CreateLeaseInput, createLeaseInputFixture],
  ["UpdateLeaseInput", UpdateLeaseInput, updateLeaseInputFixture],
  ["CaptureExpenseInput", CaptureExpenseInput, captureExpenseInputFixture],
  ["CreateMeterReadingInput", CreateMeterReadingInput, createMeterReadingInputFixture],
  ["InboxDecisionInput", InboxDecisionInput, inboxDecisionInputFixture],
  ["InboxIntent", InboxIntent, inboxIntentFixture],
] as const;

describe("inputs are strict", () => {
  it.each(strictCases)("%s refuses an unknown property", (_name, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
    expect(schema.safeParse({ ...fixture, organizationId: "injected" }).success).toBe(false);
  });
});

describe("optimistic locking", () => {
  it("an update input without expectedVersion is refused", () => {
    const { expectedVersion: _dropped, ...withoutVersion } = updateLeaseInputFixture;
    expect(UpdateLeaseInput.safeParse(withoutVersion).success).toBe(false);
  });
});

describe("upload input", () => {
  it("requires a sha256 and a positive length", () => {
    const valid = {
      filename: "facture-2026-0451.pdf",
      contentType: "application/pdf",
      contentLength: 184320,
      sha256: sha256Fixture,
    };
    expect(CreateUploadInput.safeParse(valid).success).toBe(true);
    expect(CreateUploadInput.safeParse({ ...valid, sha256: "abc" }).success).toBe(false);
    expect(CreateUploadInput.safeParse({ ...valid, contentLength: 0 }).success).toBe(false);
  });
});
