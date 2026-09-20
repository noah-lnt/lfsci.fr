import { describe, expect, it } from "vitest";
import {
  CommandEnvelope,
  CommandState,
  CommandType,
  commandPayloads,
  decisionLevelByCommand,
  resolveDecisionLevel,
} from "../src/commands";
import { CommandStatus } from "../src/enums";
import { commandEnvelopeFixtures, ids, sha256Fixture } from "../src/fixtures";

describe("decision levels (spec §17.1)", () => {
  it("covers every command type", () => {
    expect(Object.keys(decisionLevelByCommand).sort()).toEqual([...CommandType.options].sort());
  });

  it("keeps the sensitive commands at D", () => {
    for (const type of [
      "revise_rent",
      "activate_rule",
      "record_cca_movement",
      "convert_acquisition",
    ] as const) {
      expect(decisionLevelByCommand[type]).toBe("D");
    }
  });

  it("escalates a supplier bill to D on a new supplier or a changed payment identity", () => {
    expect(resolveDecisionLevel("post_supplier_bill")).toBe("C");
    expect(resolveDecisionLevel("post_supplier_bill", { isNewSupplier: true })).toBe("D");
    expect(resolveDecisionLevel("post_supplier_bill", { paymentIdentityChanged: true })).toBe("D");
    expect(resolveDecisionLevel("issue_receipt", { isNewSupplier: true })).toBe("B");
  });
});

describe("CommandState", () => {
  it("is the SQL command.status vocabulary", () => {
    expect(CommandState.options).toEqual(CommandStatus.options);
  });
});

describe("CommandEnvelope (ARC-02)", () => {
  it.each(CommandType.options.map((type) => [type] as const))("accepts a valid %s", (type) => {
    expect(CommandEnvelope.safeParse(commandEnvelopeFixtures[type]).success).toBe(true);
  });

  it("refuses an unknown command type", () => {
    const result = CommandEnvelope.safeParse({
      ...commandEnvelopeFixtures.prepare_rent_accounting,
      command: "delete_everything",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a payload of the wrong shape for its type", () => {
    const result = CommandEnvelope.safeParse({
      ...commandEnvelopeFixtures.issue_receipt,
      payload: commandEnvelopeFixtures.prepare_rent_accounting.payload,
    });
    expect(result.success).toBe(false);
  });

  it("refuses an unknown property inside a payload", () => {
    const result = CommandEnvelope.safeParse({
      ...commandEnvelopeFixtures.activate_rule,
      payload: { ...commandEnvelopeFixtures.activate_rule.payload, bypassApproval: true },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a payload hash that is not sha256 hex", () => {
    const result = CommandEnvelope.safeParse({
      ...commandEnvelopeFixtures.prepare_rent_accounting,
      payloadHash: "not-a-hash",
    });
    expect(result.success).toBe(false);
  });

  it("declares a payload schema for every command type", () => {
    expect(Object.keys(commandPayloads).sort()).toEqual([...CommandType.options].sort());
    expect(
      commandPayloads.attach_document_to_odoo.safeParse({
        documentId: ids.document,
        documentVersionId: ids.documentVersion,
        sha256: sha256Fixture,
        odooModel: "account.move",
        odooRecordId: 3141,
      }).success,
    ).toBe(true);
  });
});
