import { describe, expect, it } from "vitest";
import { DRAFT_STORE, OUTBOX_STORE, SNAPSHOT_STORE, adoptUnowned } from "./idb";

/**
 * The upgrade that gave every queued entry and draft an author.
 *
 * Driven with a stand-in transaction rather than a real IndexedDB: the repo
 * carries no fake of one, and what is worth pinning is not that a browser can
 * run a cursor but what the upgrade decides for each record it finds — whose
 * it becomes, and that nothing it cannot place is placed anyway.
 */

type Row = Record<string, unknown>;

/** A request that answers on the next microtask, as IndexedDB's do. */
function answer<T>(value: T) {
  const request: {
    result?: T;
    onsuccess: (() => void) | null;
    onerror: ((event: Event) => void) | null;
  } = { onsuccess: null, onerror: null };
  queueMicrotask(() => {
    request.result = value;
    request.onsuccess?.();
  });
  return request;
}

function store(keyPath: string, rows: Row[]) {
  const byKey = new Map(rows.map((row) => [row[keyPath], row]));
  return {
    byKey,
    getAll: () => answer([...byKey.values()]),
    get: (key: unknown) => answer(byKey.get(key)),
    put: (row: Row) => {
      byKey.set(row[keyPath], row);
      return answer(row[keyPath]);
    },
  };
}

function upgrade(stores: Record<string, ReturnType<typeof store>>) {
  adoptUnowned({
    objectStore: (name: string) => {
      const found = stores[name];
      if (!found) throw new DOMException("No such store", "NotFoundError");
      return found;
    },
  } as unknown as IDBTransaction);
  // Every request above answers on a microtask, and the ones they start
  // answer on the next; a macrotask is after all of them.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const LISBON = "22222222-2222-4222-8222-222222222222";
const ADA_SEAT = "aaaaaaaa-0000-4000-8000-00000000000a";

/** A snapshot as the version before this one wrote it: no `userId`. */
const LISBON_SNAPSHOT = {
  groupId: LISBON,
  groupName: "Lisbon",
  selfId: ADA_SEAT,
};

describe("adoptUnowned", () => {
  it("gives an older queued entry the seat its group's snapshot named", async () => {
    // The snapshot was written by the same form that queued the entry, so the
    // seat it names is whoever was typing. Stamped as a seat rather than an
    // account because a snapshot this old never recorded the account.
    const outbox = store("clientKey", [{ clientKey: "k1", groupId: LISBON }]);
    await upgrade({
      [OUTBOX_STORE]: outbox,
      [DRAFT_STORE]: store("groupId", []),
      [SNAPSHOT_STORE]: store("groupId", [LISBON_SNAPSHOT]),
    });

    expect(outbox.byKey.get("k1")).toEqual({
      clientKey: "k1",
      groupId: LISBON,
      owner: { kind: "participant", groupId: LISBON, participantId: ADA_SEAT },
    });
  });

  it("gives an older draft its author the same way", async () => {
    const drafts = store("groupId", [{ groupId: LISBON, savedAt: 1 }]);
    await upgrade({
      [OUTBOX_STORE]: store("clientKey", []),
      [DRAFT_STORE]: drafts,
      [SNAPSHOT_STORE]: store("groupId", [LISBON_SNAPSHOT]),
    });

    expect(drafts.byKey.get(LISBON)).toMatchObject({
      owner: { kind: "participant", participantId: ADA_SEAT },
    });
  });

  it("leaves a record that already has an author alone", async () => {
    const owner = { kind: "user", userId: "someone" };
    const outbox = store("clientKey", [
      { clientKey: "k1", groupId: LISBON, owner },
    ]);
    await upgrade({
      [OUTBOX_STORE]: outbox,
      [DRAFT_STORE]: store("groupId", []),
      [SNAPSHOT_STORE]: store("groupId", [LISBON_SNAPSHOT]),
    });

    expect(outbox.byKey.get("k1")!.owner).toBe(owner);
  });

  it("leaves an entry with no snapshot behind it unowned, rather than guessing", async () => {
    const outbox = store("clientKey", [{ clientKey: "k1", groupId: LISBON }]);
    await upgrade({
      [OUTBOX_STORE]: outbox,
      [DRAFT_STORE]: store("groupId", []),
      [SNAPSHOT_STORE]: store("groupId", []),
    });

    expect(outbox.byKey.get("k1")!.owner).toBeUndefined();
  });

  it("never throws out of the upgrade, whatever is missing", async () => {
    // An exception here would abort the version change and leave the store
    // unopenable on every visit after.
    await expect(upgrade({})).resolves.toBeUndefined();
    await expect(
      upgrade({
        [OUTBOX_STORE]: store("clientKey", [{ clientKey: "k1" }]),
        [SNAPSHOT_STORE]: store("groupId", []),
      }),
    ).resolves.toBeUndefined();
  });
});
