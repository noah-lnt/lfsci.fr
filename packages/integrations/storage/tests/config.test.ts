import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORAGE_ENDPOINT,
  DEFAULT_STORAGE_REGION,
  storageConfigFromEnv,
} from "../src/config";

describe("storageConfigFromEnv", () => {
  it("defaults to the Scaleway fr-par endpoint", () => {
    expect(
      storageConfigFromEnv({
        STORAGE_BUCKET: "lfsci-docs",
        STORAGE_ACCESS_KEY_ID: "k",
        STORAGE_SECRET_ACCESS_KEY: "s",
      }),
    ).toEqual({
      endpoint: DEFAULT_STORAGE_ENDPOINT,
      region: DEFAULT_STORAGE_REGION,
      bucket: "lfsci-docs",
      accessKeyId: "k",
      secretAccessKey: "s",
      forcePathStyle: false,
    });
  });

  it("fails loudly when the bucket is missing", () => {
    expect(() =>
      storageConfigFromEnv({ STORAGE_ACCESS_KEY_ID: "k", STORAGE_SECRET_ACCESS_KEY: "s" }),
    ).toThrow(/invalid environment/);
  });
});
