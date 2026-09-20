import { describe, expect, it } from "vitest";
import { SMSMODE_BASE_URL, smsConfigFromEnv } from "../src/config";

describe("smsConfigFromEnv", () => {
  it("reads the sender and the long-code flag", () => {
    expect(
      smsConfigFromEnv({
        SMSMODE_API_KEY: "k",
        SMSMODE_SENDER: "33757000000",
        SMSMODE_SENDER_IS_LONG_CODE: "true",
      }),
    ).toEqual({
      apiKey: "k",
      baseUrl: SMSMODE_BASE_URL,
      sender: "33757000000",
      senderIsLongCode: true,
      timeoutMs: 15_000,
    });
  });

  it("fails loudly without an api key", () => {
    expect(() => smsConfigFromEnv({ SMSMODE_SENDER: "LFSCI" })).toThrow(/invalid environment/);
  });
});
