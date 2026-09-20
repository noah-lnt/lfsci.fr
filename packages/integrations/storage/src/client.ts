import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "@lfsci/kernel";
import type { StorageConfig } from "./config";
import { MAX_UPLOAD_BYTES, safeFilename } from "./keys";

export const DEFAULT_PRESIGN_SECONDS = 900;

export type PresignedUpload = {
  url: string;
  key: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresInSeconds: number;
};

export type ObjectHead = {
  key: string;
  contentLength: number;
  contentType: string | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

export type Storage = {
  client: S3Client;
  presignUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds?: number;
  }): Promise<PresignedUpload>;
  presignDownload(input: {
    key: string;
    expiresInSeconds?: number;
    downloadFilename?: string;
  }): Promise<string>;
  headObject(key: string): Promise<ObjectHead>;
  deleteObject(key: string): Promise<void>;
};

export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function storageError(cause: unknown): AppError {
  if (cause instanceof NotFound) return new AppError("NOT_FOUND", { cause });
  return new AppError("UPSTREAM_UNAVAILABLE", { message: "object storage unavailable", cause });
}

export function createStorage(input: { config: StorageConfig; client?: S3Client }): Storage {
  const { config } = input;
  const client = input.client ?? createS3Client(config);

  return {
    client,

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
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn,
        // content-length is not signed: browsers set it themselves and cannot be told to (S3 PUT from the client).
        signableHeaders: new Set(["content-type"]),
      });
      return {
        url,
        key,
        method: "PUT",
        headers: { "content-type": contentType },
        expiresInSeconds: expiresIn,
      };
    },

    async presignDownload({ key, expiresInSeconds, downloadFilename }) {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ...(downloadFilename
          ? {
              ResponseContentDisposition: `attachment; filename="${safeFilename(downloadFilename)}"`,
            }
          : {}),
      });
      return getSignedUrl(client, command, {
        expiresIn: expiresInSeconds ?? DEFAULT_PRESIGN_SECONDS,
      });
    },

    async headObject(key) {
      try {
        const out: HeadObjectCommandOutput = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          key,
          contentLength: out.ContentLength ?? 0,
          contentType: out.ContentType,
          etag: out.ETag,
          lastModified: out.LastModified,
        };
      } catch (cause) {
        throw storageError(cause);
      }
    },

    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (cause) {
        throw storageError(cause);
      }
    },
  };
}
