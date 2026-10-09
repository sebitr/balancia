import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";
import { getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { BackupError } from "@/modules/backup/errors";
import { parseBundleName } from "@/modules/backup/naming";
import { BackupInputError, readBackupFile } from "@/modules/backup/service";

/**
 * One backup, still encrypted, so the restore screen can decrypt it in the
 * browser without the person first downloading it from their cloud by hand.
 *
 * This server reads ciphertext from the cloud and passes ciphertext to the
 * browser. It cannot open it, and nothing here tries to. The file name is
 * checked against the one pattern backups are written under before anything is
 * fetched, so this is not a way to read an arbitrary file out of someone's
 * cloud account.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/backup/destinations/[id]/files/[name]">,
) {
  return trackRoute("/api/backup/destinations/[id]/files/[name]", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  _request: Request,
  context: RouteContext<"/api/backup/destinations/[id]/files/[name]">,
) {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  const { id, name } = await context.params;
  if (!isUuid(id) || parseBundleName(name) === null) {
    return NextResponse.json({ error: t("notFound") }, { status: 404 });
  }

  const limit = await consumeRateLimit("backupDownload", user.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: t("rateLimited") },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  try {
    const bytes = await readBackupFile(user.userId, id, name);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof BackupInputError) {
      return NextResponse.json({ error: t("notFound") }, { status: 404 });
    }
    if (error instanceof BackupError) {
      return NextResponse.json({ code: error.code }, { status: 502 });
    }
    throw error;
  }
}
