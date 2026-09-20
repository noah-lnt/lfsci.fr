import { AppError } from "@lfsci/kernel";
import { describe, expect, it } from "vitest";
import { createBreaker } from "../src/breaker";
import { runOperation } from "../src/jobs/odooCommands";
import { backoffSeconds, operationRefFor } from "../src/jobs/outboxDispatch";
import { fakeDeps, fakeOdooPort } from "./fakes";

function breaker() {
  return createBreaker({ name: "odoo", threshold: 3, cooldownMs: 60_000 });
}

describe("circuit breaker", () => {
  it("opens after N consecutive transport failures and closes after the cooldown", () => {
    const b = breaker();
    b.recordTransportFailure(0);
    b.recordTransportFailure(0);
    expect(b.state(0)).toBe("closed");
    b.recordTransportFailure(0);
    expect(b.state(0)).toBe("open");
    expect(b.state(59_999)).toBe("open");
    expect(b.state(60_000)).toBe("closed");
  });

  it("never counts a business rejection — a refused folder is not a dead portal", () => {
    const b = breaker();
    for (let i = 0; i < 50; i += 1) b.recordBusinessRejection();
    expect(b.state(0)).toBe("closed");
    expect(b.consecutiveFailures()).toBe(0);
  });

  it("a success in the middle resets the run", () => {
    const b = breaker();
    b.recordTransportFailure(0);
    b.recordTransportFailure(0);
    b.recordSuccess();
    b.recordTransportFailure(0);
    expect(b.state(0)).toBe("closed");
  });
});

describe("dispatch helpers", () => {
  it("derives a stable operation reference from the command id", () => {
    const id = "0199a000-0000-7000-8000-000000000001";
    expect(operationRefFor(id)).toBe(`lfsci:${id}`);
    expect(operationRefFor(id)).toBe(operationRefFor(id));
  });

  it("backs off exponentially and caps at one hour", () => {
    const entry = (attempts: number) => ({ attempts }) as Parameters<typeof backoffSeconds>[0];
    expect(backoffSeconds(entry(0))).toBe(30);
    expect(backoffSeconds(entry(3))).toBe(240);
    expect(backoffSeconds(entry(20))).toBe(3600);
  });

  it("refuses a command type with no confirmed Odoo entry point", async () => {
    const deps = fakeDeps({ odoo: fakeOdooPort({}) });
    const command = {
      commandType: "convert_acquisition",
      payload: {},
    } as Parameters<typeof runOperation>[1];

    await expect(runOperation(deps, command, "lfsci:x")).rejects.toMatchObject({
      code: "RULE_VIOLATION",
    });
    await runOperation(deps, command, "lfsci:x").catch((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({ reason: "no_typed_operation" });
    });
  });
});
