import { getEnv } from "@/lib/env";
import { LocalStorageDriver } from "./local-driver";
import { S3StorageDriver } from "./s3-driver";
import type { StorageDriver } from "./types";

export * from "./types";
export { LocalStorageDriver } from "./local-driver";
export { S3StorageDriver } from "./s3-driver";

let driver: StorageDriver | undefined;

/** The configured storage driver, built once per process. */
export function getStorage(): StorageDriver {
  if (driver) return driver;
  const env = getEnv();

  driver =
    env.STORAGE_DRIVER === "s3"
      ? new S3StorageDriver({
          bucket: env.S3_BUCKET as string,
          region: env.S3_REGION as string,
          endpoint: env.S3_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new LocalStorageDriver(env.STORAGE_LOCAL_PATH);

  return driver;
}

/** Test hook. */
export function setStorageDriver(next: StorageDriver | undefined): void {
  driver = next;
}
