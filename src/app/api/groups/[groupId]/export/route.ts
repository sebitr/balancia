import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
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
  const format = formatSchema.parse(
    new URL(request.url).searchParams.get("format"),
  );

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
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
    logger.error(
      { err: error instanceof Error ? error.message : String(error), groupId },
      "Group export failed",
    );
    return NextResponse.json({ error: "Unavailable." }, { status: 500 });
  }
}
