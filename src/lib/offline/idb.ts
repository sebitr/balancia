/**
 * The device's own store, and the whole of this app's dependency on IndexedDB.
 *
 * Deliberately thin, and deliberately hand-rolled. What the offline outbox
 * needs is get, put, delete and "everything in this store" over two object
 * stores keyed by a string — a library for that would be a bigger download
 * than the feature. Everything with a decision in it lives in `replay.ts`,
 * where it can be tested without a browser.
 *
 * Every export answers rather than throws. A store that cannot be opened is
 * ordinary here, not exceptional: Safari refuses IndexedDB in private windows
 * and can evict the database between visits, and this module is also imported
 * by components that render on the server, where there is no `indexedDB` at
 * all. A caller that had to guard each of those separately would eventually
 * forget one, and the failure would be an expense that vanished — so the
 * guarding is here, once, and a missing store reads as an empty one.
 */

import { ownerFor, snapshotActor } from "./owner";

const DB_NAME = "balancia-offline";
/**
 * Version 4 added no store. It is the version at which queued entries and
 * drafts started carrying who wrote them, and the bump is what gets the older
 * ones adopted, once — see `adoptUnowned`.
 */
const DB_VERSION = 4;

/** What the entry form needs to render with no network. See `snapshot.ts`. */
export const SNAPSHOT_STORE = "group-snapshots";

/** Entries typed offline, waiting to be sent. See `outbox.ts`. */
export const OUTBOX_STORE = "outbox";

/**
 * One half-written entry per group, kept when the drawer is closed with
 * something in it. See `drafts.ts`.
 *
 * Local to the device and never synced: a half-typed amount visible to
 * flatmates is worse than losing it.
 */
export const DRAFT_STORE = "entry-drafts";

/**
 * What another app just shared, between the service worker taking the POST and
 * the screen that reads it. See `shared.ts`.
 *
 * A store rather than a query string because a share carries files: a photo of
 * a receipt cannot travel in a URL, and the worker that receives it cannot hand
 * a `File` to a page any other way.
 */
export const SHARE_STORE = "shared-payloads";

function available(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    // Reading the global itself throws in some locked-down configurations.
    return false;
  }
}

/**
 * Opens the database, creating the two stores on first use.
 *
 * `blocked` fires when another tab still holds an older version open. There is
 * nothing useful to do about it — the other tab is a person's live session, and
 * this one is a background flush — so the open is abandoned and the caller
 * treats the store as unavailable until next time.
 */
function open(): Promise<IDBDatabase | null> {
  if (!available()) return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: "groupId" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "clientKey" });
      }
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: "groupId" });
      }
      if (!db.objectStoreNames.contains(SHARE_STORE)) {
        db.createObjectStore(SHARE_STORE, { keyPath: "id" });
      }
      if (event.oldVersion > 0 && event.oldVersion < 4 && request.transaction) {
        adoptUnowned(request.transaction);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deleting the database on sign-out, or opening a newer
      // version, must not be kept waiting on this connection.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

interface UnownedRecord {
  readonly groupId?: unknown;
  readonly owner?: unknown;
}

/**
 * Stamps every queued entry and draft from before version 4 with its author,
 * once.
 *
 * Version 4 is the one that started recording who typed what (see `owner.ts`).
 * A record older than that has no author, and working one out later, at flush
 * time, would mean reading it off a group snapshot that somebody else may have
 * rewritten since. So it is worked out here, at the one moment the answer is
 * sound: inside the upgrade, before this version has written anything at all.
 * Each record's group snapshot was written by the same form that wrote the
 * record, so the seat it names is the seat of whoever was using that form —
 * and nobody on this version can have overwritten it yet, because every write
 * waits on this upgrade first.
 *
 * Nothing here may fail the upgrade. An error on a request inside a
 * versionchange transaction aborts it, and an aborted upgrade leaves the
 * database unopenable on every visit after — every offline feature quietly
 * empty. So each request swallows its own error, and a record that cannot be
 * adopted stays as it was: kept, and never sent as anybody (see `belongsTo`).
 *
 * Exported for its test, which drives it with a stand-in transaction; nothing
 * else calls it.
 */
export function adoptUnowned(transaction: IDBTransaction): void {
  try {
    const snapshots = transaction.objectStore(SNAPSHOT_STORE);
    for (const name of [OUTBOX_STORE, DRAFT_STORE]) {
      const store = transaction.objectStore(name);
      const all = quietly(store.getAll());
      all.onsuccess = () => {
        for (const record of all.result as UnownedRecord[]) {
          if (record.owner || typeof record.groupId !== "string") continue;
          try {
            const found = quietly(snapshots.get(record.groupId));
            found.onsuccess = () => {
              const owner = adoptedOwner(found.result);
              if (owner) quietly(store.put({ ...record, owner }));
            };
          } catch {
            // Left unowned; see above.
          }
        }
      };
    }
  } catch {
    // A store that is not there has nothing in it to adopt.
  }
}

function adoptedOwner(snapshot: unknown) {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const { groupId, selfId } = snapshot as {
    groupId?: unknown;
    selfId?: unknown;
  };
  if (typeof groupId !== "string" || typeof selfId !== "string") return null;
  // A snapshot this old never has a `userId`, so this is always its seat.
  return ownerFor(snapshotActor({ groupId, selfId }));
}

function quietly<T extends IDBRequest>(request: T): T {
  request.onerror = (event) => {
    // Handled here, so the transaction it belongs to is not aborted by it.
    event.preventDefault();
    event.stopPropagation();
  };
  return request;
}

/**
 * Deletes the whole database: every snapshot, every queued entry, every draft
 * and any share waiting to be filed. It is what signing out does to this
 * device's own store — see `forget.ts`.
 *
 * Settles on `blocked` and on `error` as well as on success, and never throws.
 * Blocked means another tab still holds a connection; the deletion is not
 * cancelled by that, only queued until the connection closes, which `open`
 * makes happen at once. An error is a store the browser would not let this
 * page touch in the first place. Neither is a reason to leave somebody signed
 * in who asked to sign out.
 */
export function deleteOfflineDatabase(): Promise<void> {
  if (!available()) return Promise.resolve();

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(DB_NAME);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * Runs one transaction against one store, or resolves to `fallback` when there
 * is no store to run it against.
 *
 * The connection is closed on the way out rather than held: these are rare,
 * short interactions — a form opening, a queue draining — and a connection
 * left open is what makes the *next* version upgrade block on a tab nobody is
 * looking at.
 */
async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  const db = await open();
  if (!db) return fallback;

  try {
    return await new Promise<T>((resolve) => {
      let request: IDBRequest;
      try {
        request = run(db.transaction(store, mode).objectStore(store));
      } catch {
        resolve(fallback);
        return;
      }
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => resolve(fallback);
    });
  } finally {
    db.close();
  }
}

export function idbGet<T>(store: string, key: string): Promise<T | null> {
  return withStore<T | null>(
    store,
    "readonly",
    (objectStore) => objectStore.get(key),
    null,
  ).then((value) => value ?? null);
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return withStore<T[]>(
    store,
    "readonly",
    (objectStore) => objectStore.getAll(),
    [],
  ).then((value) => value ?? []);
}

export async function idbPut(store: string, value: unknown): Promise<void> {
  await withStore(store, "readwrite", (s) => s.put(value), undefined);
}

export async function idbDelete(store: string, key: string): Promise<void> {
  await withStore(store, "readwrite", (s) => s.delete(key), undefined);
}

/**
 * A random UUID, which is what an idempotency key has to be — the server
 * refuses a header it cannot store (see `idempotencyKey` in the mobile API).
 *
 * `crypto.randomUUID` needs a secure context, and this app can legitimately be
 * served over plain HTTP: a self-hosted instance on a home network, reached by
 * address. The service worker would not run there and neither would the
 * offline shell, but the form still does, and an entry typed into it while the
 * server is unreachable should still queue. So the v4 layout is assembled from
 * `getRandomValues` when the shorthand is missing.
 */
export function randomKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4, variant 1 — the two fields that are not random.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
