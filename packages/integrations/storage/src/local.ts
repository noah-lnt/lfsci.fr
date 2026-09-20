import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AppError } from "@lfsci/kernel";
import type { ObjectHead, PresignedUpload, Storage } from "./client";
import { DEFAULT_PRESIGN_SECONDS } from "./client";
import { MAX_UPLOAD_BYTES, safeFilename } from "./keys";

/** The presign/head/delete surface, without the S3 client the local driver has no use for. */
export type ObjectStore = Omit<Storage, "client">;

export type LocalStorage = ObjectStore & {
  readonly dir: string;
  putObject(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string }>;
  readRange(key: string, length: number): Promise<Uint8Array>;
  verifyToken(input: { method: HttpMethod; key: string; token: string; nowMs?: number }): boolean;
};

export type LocalStorageOptions = {
  /** Root directory holding the objects; created on first write. */
  dir: string;
  /** Origin the presigned URLs point at, e.g. http://localhost:3000. */
  baseUrl: string;
  secret: string;
};

export type HttpMethod = "PUT" | "GET";

export const LOCAL_STORAGE_ROUTE = "/api/storage/local";

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

export function assertSafeKey(key: string): string {
  if (!keyPattern.test(key) || key.split("/").some((part) => part === "" || part === "..")) {
    throw new AppError("VALIDATION", { message: "invalid storage key" });
  }
  return key;
}

/** Resolves the key under `dir` and refuses anything that escapes it. */
export function localObjectPath(dir: string, key: string): string {
  const root = resolve(dir);
  const path = resolve(join(root, assertSafeKey(key)));
  if (path !== root && !path.startsWith(root + sep)) {
    throw new AppError("VALIDATION", { message: "storage key escapes the local root" });
  }
  return path;
}

function sign(secret: string, method: HttpMethod, key: string, expiresAtMs: number): string {
  return createHmac("sha256", secret).update(`${method}\n${key}\n${expiresAtMs}`).digest("hex");
}

export function signLocalToken(input: {
  secret: string;
  method: HttpMethod;
  key: string;
  expiresAtMs: number;
}): string {
  return `${input.expiresAtMs}.${sign(input.secret, input.method, input.key, input.expiresAtMs)}`;
}

export function verifyLocalToken(input: {
  secret: string;
  method: HttpMethod;
  key: string;
  token: string;
  nowMs?: number;
}): boolean {
  const separator = input.token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAtMs = Number(input.token.slice(0, separator));
  const signature = input.token.slice(separator + 1);
  if (!Number.isSafeInteger(expiresAtMs) || signature.length === 0) return false;
  if ((input.nowMs ?? Date.now()) > expiresAtMs) return false;

  const expected = Buffer.from(sign(input.secret, input.method, input.key, expiresAtMs), "utf8");
  const given = Buffer.from(signature, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function url(options: LocalStorageOptions, method: HttpMethod, key: string, seconds: number) {
  const expiresAtMs = Date.now() + seconds * 1000;
  const token = signLocalToken({ secret: options.secret, method, key, expiresAtMs });
  const target = new URL(`${LOCAL_STORAGE_ROUTE}/${key}`, options.baseUrl);
  target.searchParams.set("token", token);
  return target;
}

function notFound(cause: unknown): never {
  if ((cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new AppError("NOT_FOUND", { message: "object not found", cause });
  }
  throw new AppError("UPSTREAM_UNAVAILABLE", { message: "local storage unavailable", cause });
}

const typeSuffix = ".content-type";

/**
 * Filesystem-backed stand-in for S3 in development and test: the same presign
 * contract, served back by the web app's /api/storage/local route.
 */
export function createLocalStorage(options: LocalStorageOptions): LocalStorage {
  const root = resolve(options.dir);

  async function write(path: string, body: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  return {
    dir: root,

    async presignUpload({ key, contentType, contentLength, expiresInSeconds }) {
      if (contentLength <= 0 || !Number.isInteger(contentLength)) {
        throw new AppError("VALIDATION", { message: "contentLength must be a positive integer" });
      }
      if (contentLength > MAX_UPLOAD_BYTES) {
        throw new AppError("PAYLOAD_TOO_LARGE", {
          details: { contentLength, maxUploadBytes: MAX_UPLOAD_BYTES },
        });
      }
      const expiresIn = expiresInSeconds ?? DEFAULT_PRESIGN_SECONDS;
      const upload: PresignedUpload = {
        url: url(options, "PUT", assertSafeKey(key), expiresIn).toString(),
        key,
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(contentLength) },
        expiresInSeconds: expiresIn,
      };
      return upload;
    },

    async presignDownload({ key, expiresInSeconds, downloadFilename }) {
      const target = url(
        options,
        "GET",
        assertSafeKey(key),
        expiresInSeconds ?? DEFAULT_PRESIGN_SECONDS,
      );
      if (downloadFilename) target.searchParams.set("filename", safeFilename(downloadFilename));
      return target.toString();
    },

    async headObject(key) {
      const path = localObjectPath(root, key);
      try {
        const info = await stat(path);
        const head: ObjectHead = {
          key,
          contentLength: info.size,
          contentType: await readFile(`${path}${typeSuffix}`, "utf8").catch(() => undefined),
          etag: undefined,
          lastModified: info.mtime,
        };
        return head;
      } catch (cause) {
        notFound(cause);
      }
    },

    async deleteObject(key) {
      const path = localObjectPath(root, key);
      await unlink(path).catch(() => {});
      await unlink(`${path}${typeSuffix}`).catch(() => {});
    },

    async putObject({ key, body, contentType }) {
      const path = localObjectPath(root, key);
      await write(path, body);
      await write(`${path}${typeSuffix}`, Buffer.from(contentType, "utf8"));
    },

    async getObject(key) {
      const path = localObjectPath(root, key);
      try {
        return {
          body: new Uint8Array(await readFile(path)),
          contentType:
            (await readFile(`${path}${typeSuffix}`, "utf8").catch(() => undefined)) ??
            "application/octet-stream",
        };
      } catch (cause) {
        notFound(cause);
      }
    },

    async readRange(key, length) {
      const { body } = await this.getObject(key);
      return body.slice(0, length);
    },

    verifyToken({ method, key, token, nowMs }) {
      return verifyLocalToken({
        secret: options.secret,
        method,
        key,
        token,
        ...(nowMs === undefined ? {} : { nowMs }),
      });
    },
  };
}
