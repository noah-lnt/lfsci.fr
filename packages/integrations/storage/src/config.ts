import { parseEnv, requiredString } from "@lfsci/kernel";
import { z } from "zod";

// Scaleway Object Storage, region fr-par (tech-pack §1): EU residency for tenant documents.
export const DEFAULT_STORAGE_ENDPOINT = "https://s3.fr-par.scw.cloud";
export const DEFAULT_STORAGE_REGION = "fr-par";

export const StorageConfig = z.object({
  endpoint: z.url().default(DEFAULT_STORAGE_ENDPOINT),
  region: z.string().min(1).default(DEFAULT_STORAGE_REGION),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().default(false),
});
export type StorageConfig = z.infer<typeof StorageConfig>;

export function storageConfigFromEnv(source: NodeJS.ProcessEnv = process.env): StorageConfig {
  const env = parseEnv(
    {
      STORAGE_ENDPOINT: z.url().default(DEFAULT_STORAGE_ENDPOINT),
      STORAGE_REGION: z.string().min(1).default(DEFAULT_STORAGE_REGION),
      STORAGE_BUCKET: requiredString,
      STORAGE_ACCESS_KEY_ID: requiredString,
      STORAGE_SECRET_ACCESS_KEY: requiredString,
      STORAGE_FORCE_PATH_STYLE: z.stringbool().default(false),
    },
    source,
  );
  return StorageConfig.parse({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
  });
}
