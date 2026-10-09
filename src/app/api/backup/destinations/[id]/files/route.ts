import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";
import { getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { BackupError } from "@/modules/backup/errors";
import { BackupInputError, listBackupFiles } from "@/modules/backup/service";

/**
 * The backups sitting at one of the caller's destinations, for the restore
 * screen's list. Names and times only — never contents.
 *
 * The id alone authorises nothing: the lookup is scoped to the caller, so an id
 * belonging to somebody else answers exactly as a made-up one does.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/backup/destinations/[id]/files">,
) {
  return trackRoute("/api/backup/destinations/[id]/files", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  _request: Request,
  context: RouteContext<"/api/backup/destinations/[id]/files">,
) {
  const t = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) {
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
    const files = await listBackupFiles(user.userId, id);
    return NextResponse.json(
      {
        files: files.map((file) => ({
          name: file.name,
          takenAt: file.takenAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof BackupInputError) {
      return NextResponse.json({ error: t("notFound") }, { status: 404 });
    }
    if (error instanceof BackupError) {
      // The code, for the screen to word; the provider's text stays in the log.
      return NextResponse.json({ code: error.code }, { status: 502 });
    }
    throw error;
  }
}
