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

const DB_NAME = "balancia-offline";
const DB_VERSION = 1;

/** What the entry form needs to render with no network. See `snapshot.ts`. */
export const SNAPSHOT_STORE = "group-snapshots";

/** Entries typed offline, waiting to be sent. See `outbox.ts`. */
export const OUTBOX_STORE = "outbox";

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

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: "groupId" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "clientKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
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
