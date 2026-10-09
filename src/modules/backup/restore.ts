import { decryptWith, recipientOf } from "./age";

/**
 * Opening a backup, in the browser, with the recovery key.
 *
 * This file runs on the person's own machine and nowhere else. The key is
 * typed or dropped into a page, used here, and goes no further: there is no
 * request in this module and none is made on its behalf. That is the other
 * half of the claim that the server cannot read a backup — it is also not
 * trusted to be present on the day it is needed, so everything the restore
 * screen does can be done with this file, the `.age` file and a browser, and
 * everything after that with the `age` command and `gunzip`.
 *
 * No `server-only`, no database, no Node-only API: `DecompressionStream` is in
 * every current browser and in Node.
 */

/** The newest backup format this code knows how to read. */
export const SUPPORTED_BACKUP_VERSION = 1;

export type RestoreFailure =
  /** The key does not open this file. Almost always the wrong key. */
  | "wrong-key"
  /** Not an age file, truncated, or damaged on the way. */
  | "unreadable"
  /** Decrypts, but is not something Balancia wrote. */
  | "not-a-backup"
  /** Written by a newer Balancia than this one. */
  | "too-new";

export class RestoreError extends Error {
  readonly reason: RestoreFailure;

  constructor(reason: RestoreFailure) {
    super(reason);
    this.name = "RestoreError";
    this.reason = reason;
  }
}

export interface RestoredGroup {
  readonly id: string;
  readonly name: string;
  readonly expenseCount: number;
  readonly settlementCount: number;
  readonly participantCount: number;
  /** The group exactly as Export writes it, ready for the import screen. */
  readonly json: string;
  /** A name for the downloaded file. */
  readonly fileName: string;
}

export interface RestoredBackup {
  readonly createdAt: string;
  readonly instance: string;
  readonly groups: readonly RestoredGroup[];
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function slug(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "group";
}

interface GroupLike {
  readonly balancia?: { readonly exportVersion?: unknown };
  readonly group?: { readonly id?: unknown; readonly name?: unknown };
  readonly participants?: unknown;
  readonly expenses?: unknown;
  readonly settlements?: unknown;
}

const count = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

/**
 * Decrypts and reads one backup file.
 *
 * Failures are told apart because they have different cures: a key that does
 * not fit is a thing to try again with another, a file that will not parse is
 * a download to repeat, and a backup from a newer Balancia is a reason to
 * upgrade.
 */
export async function openBackup(
  ciphertext: Uint8Array,
  identity: string,
): Promise<RestoredBackup> {
  // A key that is not a key at all is the key being wrong, not the file. The
  // library's own errors cannot tell the two apart for a mistyped or truncated
  // key — its message for a bad checksum reads like one for a damaged file — so
  // the key is checked first, on its own, and the person is told the right thing.
  if ((await recipientOf(identity)) === null) {
    throw new RestoreError("wrong-key");
  }

  let compressed: Uint8Array;
  try {
    compressed = await decryptWith(identity, ciphertext);
  } catch (error) {
    // age distinguishes "no identity matched" from "this is not an age file"
    // by message only. A file that is not age at all is "unreadable"; the rest,
    // which includes every mistyped or mismatched key, is "wrong-key".
    const message = error instanceof Error ? error.message : "";
    if (
      /header|magic|armor|parse|version|stanza|truncated|invalid/i.test(message)
    ) {
      throw new RestoreError("unreadable");
    }
    throw new RestoreError("wrong-key");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await gunzip(compressed)));
  } catch {
    throw new RestoreError("not-a-backup");
  }

  const bundle = parsed as {
    balancia?: {
      backupVersion?: unknown;
      createdAt?: unknown;
      instance?: unknown;
    };
    groups?: unknown;
  };
  const version = bundle.balancia?.backupVersion;
  if (typeof version !== "number" || !Array.isArray(bundle.groups)) {
    throw new RestoreError("not-a-backup");
  }
  if (version > SUPPORTED_BACKUP_VERSION) throw new RestoreError("too-new");

  const groups: RestoredGroup[] = [];
  const taken = new Set<string>();
  for (const entry of bundle.groups as GroupLike[]) {
    const id = entry.group?.id;
    const name = entry.group?.name;
    if (typeof id !== "string" || typeof name !== "string") {
      throw new RestoreError("not-a-backup");
    }
    // Two groups can share a name; two files cannot share a file name.
    let fileName = `balancia-${slug(name)}.json`;
    for (let n = 2; taken.has(fileName); n += 1) {
      fileName = `balancia-${slug(name)}-${n}.json`;
    }
    taken.add(fileName);

    groups.push({
      id,
      name,
      expenseCount: count(entry.expenses),
      settlementCount: count(entry.settlements),
      participantCount: count(entry.participants),
      json: JSON.stringify(entry, null, 2),
      fileName,
    });
  }

  return {
    createdAt:
      typeof bundle.balancia?.createdAt === "string"
        ? bundle.balancia.createdAt
        : "",
    instance:
      typeof bundle.balancia?.instance === "string"
        ? bundle.balancia.instance
        : "",
    groups,
  };
}
