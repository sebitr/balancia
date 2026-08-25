import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser, getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { ObjectNotFoundError } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";
import {
  AVATAR_MAX_BYTES,
  AvatarRejectedError,
  readAvatar,
  removeAvatar,
  saveAvatar,
} from "@/modules/profile/avatar";

/**
 * The signed-in account's own photo: read it, replace it, remove it.
 *
 * Deliberately only ever the caller's own. Nothing in Balancia draws another
 * person's photo yet — a participant is an initial on a tinted circle — so a
 * route that took a user id would be an enumeration surface built ahead of any
 * screen that needed it. When one does, it can be added with the group
 * authorization those screens already run.
 *
 * There is no publicly served uploads directory; this handler is the only way
 * the bytes come back out.
 */

export async function GET() {
  return trackRoute("/api/profile/avatar", "GET", handleGet);
}

export async function POST(request: Request) {
  return trackRoute("/api/profile/avatar", "POST", () => handlePost(request));
}

export async function DELETE() {
  return trackRoute("/api/profile/avatar", "DELETE", handleDelete);
}

const signedOut = async () => {
  const t = await getTranslations("serverErrors");
  return NextResponse.json({ error: t("authRequired") }, { status: 401 });
};

async function handleGet() {
  const user = await getCurrentUser();
  if (!user) return signedOut();

  const t = await getTranslations("serverErrors");

  try {
    const avatar = await readAvatar(user.userId);
    if (!avatar) {
      return NextResponse.json({ error: t("notFound") }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(avatar.bytes), {
      headers: {
        "Content-Type": avatar.contentType,
        "Content-Length": String(avatar.bytes.byteLength),
        // Sniffing is what turns a stored image into a stored script, and the
        // sandbox costs nothing on a response that is only ever an <img>.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        // Belongs to one account, so never a shared cache. `must-revalidate`
        // rather than a long max-age: a photo that has just been replaced has
        // to be the one that comes back.
        "Cache-Control": "private, max-age=0, must-revalidate",
        ...(avatar.updatedAt
          ? { ETag: `"${avatar.updatedAt.getTime().toString(36)}"` }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return NextResponse.json({ error: t("notFound") }, { status: 404 });
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Avatar could not be read",
    );
    return NextResponse.json({ error: t("unavailable") }, { status: 500 });
  }
}

async function handlePost(request: Request) {
  const user = await getCurrentUser();
  if (!user) return signedOut();

  const t = await getTranslations("serverErrors");

  const limit = await consumeRateLimit("upload", await getClientIp());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: t("uploadRateLimited") },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  // Refused before the body is buffered, so an oversize post costs no memory.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > AVATAR_MAX_BYTES + 4096) {
    return NextResponse.json({ error: t("pictureTooLarge") }, { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: t("pictureMissing") }, { status: 400 });
    }

    const avatar = await saveAvatar(
      user.userId,
      Buffer.from(await file.arrayBuffer()),
    );
    return NextResponse.json({
      contentType: avatar.contentType,
      updatedAt: avatar.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof AvatarRejectedError) {
      // Named one by one rather than through the shared code lookup: the
      // catalogue's `file*` keys are the receipt uploader's, and one of them
      // interpolates a limit this error does not carry.
      const reason = {
        fileEmpty: t("pictureEmpty"),
        fileTooLarge: t("pictureTooLarge"),
        fileType: t("pictureType"),
      }[error.code];
      return NextResponse.json(
        { error: reason, code: error.code },
        { status: error.code === "fileTooLarge" ? 413 : 400 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Avatar upload failed",
    );
    return NextResponse.json({ error: t("pictureNotSaved") }, { status: 500 });
  }
}

async function handleDelete() {
  const user = await getCurrentUser();
  if (!user) return signedOut();

  try {
    await removeAvatar(user.userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Avatar removal failed",
    );
    const t = await getTranslations("serverErrors");
    return NextResponse.json(
      { error: t("pictureNotRemoved") },
      { status: 500 },
    );
  }
}
