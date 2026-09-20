import type { S3Client } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStorage } from "../src/client";
import { StorageConfig } from "../src/config";
import { MAX_UPLOAD_BYTES } from "../src/keys";

const config = StorageConfig.parse({
  bucket: "lfsci-docs",
  accessKeyId: "SCWTESTKEY",
  secretAccessKey: "secret",
});

const key =
  "org/0198f0c0-1111-7000-8000-000000000001/doc/0198f0c0-2222-7000-8000-000000000002/v1/bail.pdf";

describe("storage client", () => {
  const storage = createStorage({ config });

  it("presigns a PUT on the fr-par endpoint with the signed content headers", async () => {
    const upload = await storage.presignUpload({
      key,
      contentType: "application/pdf",
      contentLength: 1024,
    });
    const url = new URL(upload.url);
    expect(url.origin).toBe("https://lfsci-docs.s3.fr-par.scw.cloud");
    expect(url.pathname).toBe(`/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).not.toContain("content-length");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(upload.headers).toEqual({ "content-type": "application/pdf" });
  });

  it("refuses an upload above the 50 MB ceiling before signing", async () => {
    await expect(
      storage.presignUpload({
        key,
        contentType: "application/pdf",
        contentLength: MAX_UPLOAD_BYTES + 1,
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("presigns a download with a content-disposition override", async () => {
    const url = new URL(
      await storage.presignDownload({
        key,
        expiresInSeconds: 60,
        downloadFilename: "Quittance Août.pdf",
      }),
    );
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="Quittance-Aout.pdf"',
    );
  });
});

describe("storage commands", () => {
  let sent: { name: string; input: unknown }[] = [];
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    sent = [];
    storage = createStorage({ config });
    vi.spyOn(storage.client, "send").mockImplementation(((command: {
      constructor: { name: string };
      input: unknown;
    }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      return Promise.resolve({
        ContentLength: 1024,
        ContentType: "application/pdf",
        ETag: '"abc"',
      });
    }) as S3Client["send"]);
  });

  it("heads an object through the injected client", async () => {
    await expect(storage.headObject(key)).resolves.toMatchObject({ key, contentLength: 1024 });
    expect(sent[0]).toEqual({
      name: "HeadObjectCommand",
      input: { Bucket: "lfsci-docs", Key: key },
    });
  });

  it("deletes an object and maps a transport failure to UPSTREAM_UNAVAILABLE", async () => {
    await storage.deleteObject(key);
    expect(sent[0]?.name).toBe("DeleteObjectCommand");
    vi.spyOn(storage.client, "send").mockRejectedValue(new Error("ECONNRESET") as never);
    await expect(storage.deleteObject(key)).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
  });
});
