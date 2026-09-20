import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAppError } from "@lfsci/kernel";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLocalStorage,
  type LocalStorage,
  localObjectPath,
  MAX_UPLOAD_BYTES,
  signLocalToken,
  verifyLocalToken,
} from "../src/index";

const secret = "dev-secret";
const key = "org/11111111-1111-4111-8111-111111111111/doc/x/v1/ticket.png";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let dir: string;
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "lfsci-storage-"));
  storage = createLocalStorage({ dir, baseUrl: "http://localhost:3000", secret });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return isAppError(error) ? error.code : "NOT_AN_APP_ERROR";
  }
  return "NO_ERROR";
}

describe("presigned URLs", () => {
  it("points a PUT at the local route with a token", async () => {
    const upload = await storage.presignUpload({
      key,
      contentType: "image/png",
      contentLength: png.length,
    });
    const url = new URL(upload.url);
    expect(url.pathname).toBe(`/api/storage/local/${key}`);
    expect(upload.method).toBe("PUT");
    expect(upload.headers["content-type"]).toBe("image/png");
    expect(
      storage.verifyToken({ method: "PUT", key, token: url.searchParams.get("token") ?? "" }),
    ).toBe(true);
  });

  it("refuses an oversized or non-positive upload", async () => {
    expect(
      await code(() =>
        storage.presignUpload({
          key,
          contentType: "image/png",
          contentLength: MAX_UPLOAD_BYTES + 1,
        }),
      ),
    ).toBe("PAYLOAD_TOO_LARGE");
    expect(
      await code(() => storage.presignUpload({ key, contentType: "image/png", contentLength: 0 })),
    ).toBe("VALIDATION");
  });

  it("carries the download filename on a GET", async () => {
    const url = new URL(await storage.presignDownload({ key, downloadFilename: "reçu été.pdf" }));
    expect(url.searchParams.get("filename")).toBe("recu-ete.pdf");
    expect(
      storage.verifyToken({ method: "GET", key, token: url.searchParams.get("token") ?? "" }),
    ).toBe(true);
  });
});

describe("tokens", () => {
  const expiresAtMs = Date.now() + 60_000;

  it("does not verify across methods, keys or secrets", () => {
    const token = signLocalToken({ secret, method: "PUT", key, expiresAtMs });
    expect(verifyLocalToken({ secret, method: "PUT", key, token })).toBe(true);
    expect(verifyLocalToken({ secret, method: "GET", key, token })).toBe(false);
    expect(verifyLocalToken({ secret, method: "PUT", key: `${key}.other`, token })).toBe(false);
    expect(verifyLocalToken({ secret: "other", method: "PUT", key, token })).toBe(false);
  });

  it("expires and rejects malformed tokens", () => {
    const token = signLocalToken({ secret, method: "GET", key, expiresAtMs });
    expect(verifyLocalToken({ secret, method: "GET", key, token, nowMs: expiresAtMs + 1 })).toBe(
      false,
    );
    for (const bad of ["", ".", "abc", `${expiresAtMs}.`, "12x.deadbeef"]) {
      expect(verifyLocalToken({ secret, method: "GET", key, token: bad })).toBe(false);
    }
  });
});

describe("objects", () => {
  it("round-trips a file with its content type", async () => {
    await storage.putObject({ key, body: png, contentType: "image/png" });
    const head = await storage.headObject(key);
    expect(head.contentLength).toBe(png.length);
    expect(head.contentType).toBe("image/png");
    expect(await storage.readRange(key, 8)).toEqual(png.slice(0, 8));
    expect(new Uint8Array(await readFile(localObjectPath(dir, key)))).toEqual(png);
  });

  it("reports a missing object as NOT_FOUND", async () => {
    expect(await code(() => storage.headObject(`${key}.missing`))).toBe("NOT_FOUND");
  });

  it("refuses a key escaping the root", () => {
    expect(() => localObjectPath(dir, "org/../../etc/passwd")).toThrow();
    expect(() => localObjectPath(dir, "/absolute")).toThrow();
  });

  it("deletes idempotently", async () => {
    await storage.deleteObject(key);
    await storage.deleteObject(key);
    expect(await code(() => storage.getObject(key))).toBe("NOT_FOUND");
  });
});
