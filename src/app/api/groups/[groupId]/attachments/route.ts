import { NextResponse } from "next/server";
import { apiActor } from "@/app/api/mobile";
import { getClientIp } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  fileTooLarge,
  uploadAttachment,
  UploadRejectedError,
} from "@/modules/attachments/service";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";
import { describeError } from "@/lib/server-errors";
import { readUploadForm } from "@/lib/upload-limit";

/**
 * Receipt upload.
 *
 * Authorization first, then a rate limit, then the domain service — which is
 * where content sniffing, size limits and key generation live. Nothing about
 * the uploaded file is trusted: not its name, not its Content-Type.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/attachments">,
) {
  return trackRoute("/api/groups/[groupId]/attachments", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/attachments">,
) {
  const { groupId } = await context.params;

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/attachments",
      "POST",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });

    const limit = await consumeRateLimit("upload", await getClientIp());
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    // Refused on the bytes that actually arrive, not on the size the request
    // declared: a chunked upload declares none.
    const maxBytes = getEnv().UPLOAD_MAX_BYTES;
    const formData = await readUploadForm(request, maxBytes);
    if (!formData) throw fileTooLarge(maxBytes);

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was sent." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(access, {
      name: file.name,
      bytes,
    });

    return NextResponse.json({
      id: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize.toString(),
    });
  } catch (error) {
    if (error instanceof UploadRejectedError) {
      // In the reader's language, and with the reason as a code for a client
      // that words its own refusals.
      return NextResponse.json(
        { error: await describeError(error), code: error.code },
        { status: error.code === "fileTooLarge" ? 413 : 400 },
      );
    }
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
    // An API key that will not do — read-only, pinned elsewhere. By name
    // rather than by class, like the two above: this catch dispatches on
    // `error.name` throughout, and one branch importing a constructor while
    // its neighbours do not would read as a distinction that isn't there.
    if (error instanceof Error && error.name === "TokenScopeError") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error), groupId },
      "Attachment upload failed",
    );
    return NextResponse.json(
      { error: "The upload could not be completed." },
      { status: 500 },
    );
  }
}
