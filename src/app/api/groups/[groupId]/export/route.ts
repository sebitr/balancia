import { NextResponse } from "next/server";
import { z } from "zod";
import { isUuid } from "@/app/api/mobile";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  buildGroupExport,
  exportFileName,
  toExpensesCsv,
  toWorkbook,
} from "@/modules/exports/service";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Group export download.
 *
 * Same shape as the receipt download: authorization runs on every request,
 * every query is scoped to the authorized group, and an authorization failure
 * is reported as 404 so group existence is not probeable.
 *
 * The response is `Content-Disposition: attachment` with `private, no-store` —
 * a group's whole financial history must not sit in a shared proxy's cache.
 */

const formatSchema = z.enum(["json", "csv", "xlsx"]).catch("json");

const CONTENT_TYPES = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/export">,
) {
  return trackRoute("/api/groups/[groupId]/export", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/export">,
) {
  const { groupId } = await context.params;
  // Before any query: PostgreSQL throws on a malformed UUID, which would
  // answer 500 for what is only a group that does not exist.
  if (!isUuid(groupId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const format = formatSchema.parse(
    new URL(request.url).searchParams.get("format"),
  );

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);

    // Everything below is built in memory at once, so how often one person
    // can ask for it is bounded — per group, because the account's data
    // screen offers every group from one picker and a backup of each is not
    // abuse.
    const who =
      access.actor.kind === "user"
        ? `user:${access.actor.userId}`
        : `guest:${access.actor.sessionId}`;
    const limit = await consumeRateLimit("export", `${who}:${access.groupId}`);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many exports. Try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    // buildGroupExport requires the exportData permission, so a guest is
    // refused here rather than after the work is done.
    const data = await buildGroupExport(access);

    const body: Uint8Array | string =
      format === "xlsx"
        ? toWorkbook(data)
        : format === "csv"
          ? toExpensesCsv(data)
          : JSON.stringify(data, null, 2);

    const fileName = exportFileName(access.group.name, format);
    const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_");
    const encodedName = encodeURIComponent(fileName);

    return new NextResponse(
      typeof body === "string" ? body : new Uint8Array(body),
      {
        headers: {
          "Content-Type": CONTENT_TYPES[format],
          "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AuthorizationError") {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    if (
      error instanceof Error &&
      error.name === "AuthenticationRequiredError"
    ) {
      return NextResponse.json(
        { error: "Sign in to continue." },
        { status: 401 },
      );
    }
    logger.error({ err: error, groupId }, "Group export failed");
    return NextResponse.json({ error: "Unavailable." }, { status: 500 });
  }
}
