import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES_CACHE, forgetDevice } from "./forget";

/**
 * What signing out takes off the device.
 *
 * Both stores are stood in for: there is no Cache Storage and no IndexedDB
 * under Node, and the repo carries no fake of either. What matters is which
 * cache is deleted, that the database is, and that nothing here can stop a
 * sign-out from going ahead.
 */

/** An IndexedDB whose delete answers with `outcome` on the next microtask. */
function indexedDBAnswering(outcome: "onsuccess" | "onblocked" | "onerror") {
  const deleteDatabase = vi.fn(() => {
    const request: Record<string, (() => void) | null> = {
      onsuccess: null,
      onblocked: null,
      onerror: null,
    };
    queueMicrotask(() => request[outcome]?.());
    return request;
  });
  vi.stubGlobal("indexedDB", { deleteDatabase });
  return deleteDatabase;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forgetDevice", () => {
  it("deletes the page cache and the offline database", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });
    const deleteDatabase = indexedDBAnswering("onsuccess");

    await forgetDevice();

    // The cache the worker fills with server-rendered screens, by the name
    // the worker itself uses for it.
    expect(PAGES_CACHE).toBe("balancia-pages");
    expect(deleteCache).toHaveBeenCalledExactlyOnceWith("balancia-pages");
    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("balancia-offline");
  });

  it("deletes nothing else from Cache Storage", async () => {
    // Build output, icons and model files are everybody's, and the models are
    // tens of megabytes to fetch again.
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", { delete: deleteCache });
    indexedDBAnswering("onsuccess");

    await forgetDevice();

    expect(deleteCache).toHaveBeenCalledTimes(1);
  });

  it("does not wait on another tab holding the database open", async () => {
    // Blocked is not refused: the deletion goes through when that tab lets
    // go. Holding a sign-out on a tab nobody is looking at would be worse.
    vi.stubGlobal("caches", { delete: vi.fn().mockResolvedValue(true) });
    indexedDBAnswering("onblocked");

    await expect(forgetDevice()).resolves.toBeUndefined();
  });

  it("settles, and never throws, where either store is missing or refuses", async () => {
    // Plain HTTP has no Cache Storage; a locked-down profile refuses both.
    indexedDBAnswering("onerror");
    await expect(forgetDevice()).resolves.toBeUndefined();

    vi.stubGlobal("caches", {
      delete: vi.fn().mockRejectedValue(new Error("SecurityError")),
    });
    vi.stubGlobal("indexedDB", {
      deleteDatabase: () => {
        throw new Error("SecurityError");
      },
    });
    await expect(forgetDevice()).resolves.toBeUndefined();
  });
});
