import "server-only";
import { join, resolve, sep } from "node:path";
import {
  createLocalStorage,
  createStorage,
  type LocalStorage,
  type ObjectStore,
  StorageConfig,
} from "@lfsci/storage";
import { env, isDevOrTest } from "./env";

/** The presign surface plus the range read `finalizeUpload` needs to sniff a type. */
export type DocumentStore = ObjectStore & {
  readRange(key: string, length: number): Promise<Uint8Array>;
};

function localDir(): string {
  const configured = process.env.STORAGE_LOCAL_DIR;
  if (configured) return resolve(configured);
  const cwd = process.cwd();
  return cwd.endsWith(`${sep}apps${sep}web`)
    ? join(cwd, ".storage")
    : join(cwd, "apps", "web", ".storage");
}

let local: LocalStorage | undefined;

/** Non-null only when the app is running on the filesystem driver. */
export function localStorageDriver(): LocalStorage | null {
  if (!localDriverEnabled()) return null;
  if (!local) {
    local = createLocalStorage({
      dir: localDir(),
      baseUrl: env().BETTER_AUTH_URL,
      secret: env().BETTER_AUTH_SECRET,
    });
  }
  return local;
}

/** No S3 credentials outside production means the filesystem driver, never a half-configured S3. */
export function localDriverEnabled(): boolean {
  return isDevOrTest() && !(process.env.STORAGE_ACCESS_KEY_ID ?? "").trim();
}

let remote: DocumentStore | undefined;

function remoteStore(): DocumentStore {
  if (!remote) {
    const config = StorageConfig.parse({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION,
      bucket: process.env.STORAGE_BUCKET,
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    });
    const store = createStorage({ config });
    remote = {
      ...store,
      // A ranged GET on a short-lived presigned URL avoids pulling the S3 SDK
      // into the web app's own dependencies.
      async readRange(key, length) {
        const url = await store.presignDownload({ key, expiresInSeconds: 60 });
        const response = await fetch(url, { headers: { range: `bytes=0-${length - 1}` } });
        if (!response.ok) return new Uint8Array();
        return new Uint8Array(await response.arrayBuffer());
      },
    };
  }
  return remote;
}

export function documentStore(): DocumentStore {
  return localStorageDriver() ?? remoteStore();
}
