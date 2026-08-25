import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { setStorageDriver, type StorageDriver } from "@/lib/storage";
import {
  AVATAR_MAX_BYTES,
  AvatarRejectedError,
  getAvatarVersion,
  readAvatar,
  removeAvatar,
  saveAvatar,
} from "@/modules/profile/avatar";
import { createTestUser } from "../helpers/factories";

/**
 * The photo on an account.
 *
 * The rules that matter here are the ones a browser cannot be trusted with:
 * the type comes from the file's magic bytes rather than from what was sent,
 * the key is generated server-side so nothing user-controlled reaches a path,
 * and replacing a photo must not leave the old object behind. The client
 * squares and re-encodes before uploading, but a hand-written POST never runs
 * any of that — which is exactly what these cover.
 */

/** A one-pixel PNG, as real magic bytes rather than a claim about them. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** An HTML document wearing no disguise at all — and none is needed. */
const NOT_AN_IMAGE = Buffer.from("<!doctype html><script>alert(1)</script>");

/** Records what was written and removed, so the sweep can be asserted on. */
function fakeStorage() {
  const objects = new Map<string, Buffer>();
  const deleted: string[] = [];
  const driver: StorageDriver = {
    name: "local",
    async put(key, body) {
      objects.set(key, body);
      return { key, byteSize: body.byteLength, checksum: "sha256:test" };
    },
    async get(key) {
      const found = objects.get(key);
      if (!found) throw new Error(`no object for ${key}`);
      return found;
    },
    async delete(key) {
      objects.delete(key);
      deleted.push(key);
    },
    async exists(key) {
      return objects.has(key);
    },
  };
  return { driver, objects, deleted };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  setStorageDriver(storage.driver);
});

afterEach(() => {
  setStorageDriver(undefined);
});

describe("the photo on an account", () => {
  it("stores the sniffed type, not the one it was told", async () => {
    const actor = await createTestUser();

    const saved = await saveAvatar(actor.userId, PNG);

    expect(saved.contentType).toBe("image/png");
    const back = await readAvatar(actor.userId);
    expect(back?.contentType).toBe("image/png");
    expect(back?.bytes.equals(PNG)).toBe(true);
  });

  it("puts nothing user-controlled in the object key", async () => {
    const actor = await createTestUser();
    await saveAvatar(actor.userId, PNG);

    const [key] = [...storage.objects.keys()];
    // The account's own id namespaces it, and the rest is random — there is no
    // filename in it, because no filename ever reaches this.
    expect(key).toMatch(new RegExp(`^avatars/${actor.userId}/[0-9a-f]{48}$`));
  });

  it("refuses a file that is not an image, whatever it is called", async () => {
    const actor = await createTestUser();

    await expect(saveAvatar(actor.userId, NOT_AN_IMAGE)).rejects.toThrow(
      AvatarRejectedError,
    );
    expect(storage.objects.size).toBe(0);
    expect(await getAvatarVersion(actor.userId)).toBeNull();
  });

  it("refuses an empty file and one over the cap", async () => {
    const actor = await createTestUser();

    await expect(
      saveAvatar(actor.userId, Buffer.alloc(0)),
    ).rejects.toMatchObject({ code: "fileEmpty" });

    await expect(
      saveAvatar(actor.userId, Buffer.alloc(AVATAR_MAX_BYTES + 1, 1)),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
  });

  it("sweeps the photo it replaces", async () => {
    const actor = await createTestUser();
    await saveAvatar(actor.userId, PNG);
    const [first] = [...storage.objects.keys()];

    await saveAvatar(actor.userId, PNG);

    expect(storage.deleted).toContain(first);
    // One account, one photo: the bucket does not accumulate the old ones.
    expect(storage.objects.size).toBe(1);
  });

  it("clears the row and the object when the photo is removed", async () => {
    const actor = await createTestUser();
    await saveAvatar(actor.userId, PNG);

    await removeAvatar(actor.userId);

    expect(storage.objects.size).toBe(0);
    expect(await readAvatar(actor.userId)).toBeNull();
    const [row] = await getDb()
      .select({
        key: users.avatarStorageKey,
        type: users.avatarContentType,
        at: users.avatarUpdatedAt,
      })
      .from(users)
      .where(eq(users.id, actor.userId));
    expect(row).toEqual({ key: null, type: null, at: null });
  });

  it("moves the version forward, so a replaced photo is not read from cache", async () => {
    const actor = await createTestUser();
    await saveAvatar(actor.userId, PNG);
    const first = await getAvatarVersion(actor.userId);

    // The URL is keyed on this; two saves in the same millisecond would give
    // the same one, so the wait is the assertion's, not the code's.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveAvatar(actor.userId, PNG);
    const second = await getAvatarVersion(actor.userId);

    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it("has nothing to say about an account that never had one", async () => {
    const actor = await createTestUser();
    expect(await readAvatar(actor.userId)).toBeNull();
    expect(await getAvatarVersion(actor.userId)).toBeNull();
    await expect(removeAvatar(actor.userId)).resolves.toBeUndefined();
  });
});
