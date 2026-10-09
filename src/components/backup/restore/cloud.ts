import { MAX_BACKUP_BYTES } from "./input";

/**
 * The two requests the restore screen makes, and the only two.
 *
 * Both go to this server's own routes for the destination the person already
 * connected, and carry a destination id and a file name. The recovery key is
 * never an argument to anything in this file: it is typed into the page, used
 * in the page, and the server that answers these requests cannot read what it
 * hands over (see `src/app/api/backup/destinations/[id]/files`).
 */

export interface CloudFile {
  readonly name: string;
  readonly takenAt: string;
}

/** A request that did not give us what we asked for, with the code to word it. */
export class CloudRequestError extends Error {
  readonly code: string | null;

  constructor(code: string | null) {
    super(code ?? "cloud request failed");
    this.name = "CloudRequestError";
    this.code = code;
  }
}

/**
 * What the failure was, when the server said. The routes answer a failure at
 * the provider with `{code}` (a `BackupErrorCode`); the rate limiter's 429 has
 * no code of its own but means exactly one thing.
 */
async function failure(response: Response): Promise<CloudRequestError> {
  let code: string | null = null;
  try {
    const body = (await response.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    // Not JSON: a proxy's error page. The status is all there is.
  }
  if (code === null && response.status === 429) code = "rate_limited";
  return new CloudRequestError(code);
}

/** The backups at a destination, newest first. */
export async function listCloudBackups(
  destinationId: string,
  signal?: AbortSignal,
): Promise<CloudFile[]> {
  let response: Response;
  try {
    response = await fetch(`/api/backup/destinations/${destinationId}/files`, {
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CloudRequestError(null);
  }
  if (!response.ok) throw await failure(response);

  let body: { files?: unknown };
  try {
    body = (await response.json()) as { files?: unknown };
  } catch {
    throw new CloudRequestError(null);
  }
  if (!Array.isArray(body.files)) throw new CloudRequestError(null);

  const files = (body.files as Partial<CloudFile>[]).flatMap((file) =>
    typeof file.name === "string" && typeof file.takenAt === "string"
      ? [{ name: file.name, takenAt: file.takenAt }]
      : [],
  );
  return files.sort(
    (a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime(),
  );
}

/**
 * One backup, still encrypted. `"too-big"` when it is larger than the screen
 * will read, which is decided from the headers where the server sends them so
 * that a file that large is not downloaded just to be refused.
 */
export async function downloadCloudBackup(
  destinationId: string,
  name: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer | "too-big"> {
  let response: Response;
  try {
    response = await fetch(
      `/api/backup/destinations/${destinationId}/files/${encodeURIComponent(name)}`,
      { signal, cache: "no-store" },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CloudRequestError(null);
  }
  if (!response.ok) throw await failure(response);

  const announced = Number(response.headers.get("Content-Length"));
  if (announced > MAX_BACKUP_BYTES) return "too-big";

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    throw new CloudRequestError(null);
  }
  return bytes.byteLength > MAX_BACKUP_BYTES ? "too-big" : bytes;
}

/** The `cloudBackup.error.*` key that words a `BackupErrorCode`, if there is one. */
export type CloudErrorKey =
  | "reconnect"
  | "forbidden"
  | "quota"
  | "notFound"
  | "unreachable"
  | "rateLimited"
  | "endpointBlocked"
  | "unavailable"
  | "noKey"
  | "unknown";

const ERROR_KEYS: Readonly<Record<string, CloudErrorKey>> = {
  reconnect: "reconnect",
  forbidden: "forbidden",
  quota: "quota",
  not_found: "notFound",
  unreachable: "unreachable",
  rate_limited: "rateLimited",
  endpoint_blocked: "endpointBlocked",
  unavailable: "unavailable",
  no_key: "noKey",
  unknown: "unknown",
};

/** Null for a failure with no code (the network, a proxy): `cloudFailed` says enough. */
export function cloudErrorKey(code: string | null): CloudErrorKey | null {
  if (code === null) return null;
  return Object.hasOwn(ERROR_KEYS, code)
    ? (ERROR_KEYS[code] ?? "unknown")
    : "unknown";
}
