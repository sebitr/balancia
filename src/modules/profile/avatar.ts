import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { getDb, type Database } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getStorage } from "@/lib/storage";
import { logger } from "@/lib/logger";

/**
 * The photo on an account.
 *
 * The same rules receipts are held to, for the same reasons: the type is
 * sniffed from the file's magic bytes rather than believed from the request,
 * the stored key is generated here so nothing user-controlled reaches a path,
 * and SVG is refused outright — it is an XML document that can carry script,
 * and it would be served back from this instance's own origin.
 *
 * What differs is the size. A receipt is evidence and is kept as sent; an
 * avatar is drawn at 52 pixels and never needs to be more than a small square,
 * so `AVATAR_MAX_BYTES` is far below the general upload ceiling. The browser
 * squares and re-encodes the picture before sending it (see
 * `avatar-card.tsx`), which also drops the EXIF block — an avatar that carried
 * the GPS coordinates of where the photograph was taken would be a privacy
 * leak served from a public URL. That client step is a courtesy, not the
 * guard: everything below is enforced again here, because a hand-written POST
 * never runs it.
 */

/** Comfortably above a 512px square WebP, comfortably below a raw photograph. */
export const AVATAR_MAX_BYTES = 1024 * 1024;

/**
 * Raster only, and only the four every browser can both produce and display.
 * HEIC is absent on purpose: Safari can encode it, most browsers cannot show
 * it, and the client re-encodes to WebP long before this list is consulted.
 */
const ALLOWED_MIME_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/png",
  "image/gif",
]);

export class AvatarRejectedError extends Error {
  constructor(
    message: string,
    readonly code: "fileEmpty" | "fileTooLarge" | "fileType",
  ) {
    super(message);
    this.name = "AvatarRejectedError";
  }
}

export interface StoredAvatar {
  readonly contentType: string;
  readonly updatedAt: Date;
}

function generateStorageKey(userId: string): string {
  return `avatars/${userId}/${randomBytes(24).toString("hex")}`;
}

/**
 * Removes an object without letting the failure reach the caller.
 *
 * A key that outlives its row is litter in a bucket; a request that fails
 * because the *old* photo could not be swept is a photo the account did not
 * get to change. The first is cheaper, so the sweep is best-effort and says so
 * in the log.
 */
async function sweep(key: string | null): Promise<void> {
  if (!key) return;
  try {
    await getStorage().delete(key);
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error), key },
      "Orphaned avatar object could not be removed",
    );
  }
}

/**
 * Stores a new photo for an account and forgets the one it replaces.
 *
 * The object is written before the row so a crash in between leaves an unused
 * object rather than a row pointing at nothing — the first is invisible, the
 * second is a broken image on every screen the account appears on.
 */
export async function saveAvatar(
  userId: string,
  bytes: Buffer,
  options: { db?: Database } = {},
): Promise<StoredAvatar> {
  const db = options.db ?? getDb();

  if (bytes.byteLength === 0) {
    throw new AvatarRejectedError("That file is empty.", "fileEmpty");
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    throw new AvatarRejectedError("That picture is too large.", "fileTooLarge");
  }

  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new AvatarRejectedError(
      "A photo must be a JPEG, PNG, WebP or GIF image.",
      "fileType",
    );
  }

  const [previous] = await db
    .select({ key: users.avatarStorageKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const stored = await getStorage().put(
    generateStorageKey(userId),
    bytes,
    detected.mime,
  );
  const updatedAt = new Date();

  try {
    await db
      .update(users)
      .set({
        avatarStorageKey: stored.key,
        avatarContentType: detected.mime,
        avatarUpdatedAt: updatedAt,
        updatedAt,
      })
      .where(eq(users.id, userId));
  } catch (error) {
    // The row still points at the old object, so the new one is the orphan.
    await sweep(stored.key);
    throw error;
  }

  await sweep(previous?.key ?? null);
  return { contentType: detected.mime, updatedAt };
}

/** Clears the photo, leaving the initial that was there before it. */
export async function removeAvatar(
  userId: string,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  const [previous] = await db
    .select({ key: users.avatarStorageKey })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!previous?.key) return;

  // The row first this time: an account that says it has no photo and an
  // object nobody reads is the harmless order of these two failing.
  await db
    .update(users)
    .set({
      avatarStorageKey: null,
      avatarContentType: null,
      avatarUpdatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await sweep(previous.key);
}

export interface AvatarContent {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly updatedAt: Date | null;
}

/** What the delivery route answers with, or null for an account with no photo. */
export async function readAvatar(
  userId: string,
  options: { db?: Database } = {},
): Promise<AvatarContent | null> {
  const db = options.db ?? getDb();

  const [row] = await db
    .select({
      key: users.avatarStorageKey,
      contentType: users.avatarContentType,
      updatedAt: users.avatarUpdatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row?.key || !row.contentType) return null;

  return {
    bytes: await getStorage().get(row.key),
    contentType: row.contentType,
    updatedAt: row.updatedAt,
  };
}

/**
 * When the account's photo last changed, or null if it has none.
 *
 * The screens that draw an avatar need two things: whether to ask for the
 * image at all, and a value that changes when the picture does. This is both.
 * The timestamp goes on the URL as a query parameter, so a photo replaced a
 * second ago is fetched rather than read from the cache the old one left.
 */
export async function getAvatarVersion(
  userId: string,
  options: { db?: Database } = {},
): Promise<Date | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({ updatedAt: users.avatarUpdatedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.updatedAt ?? null;
}
