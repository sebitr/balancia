import { NextResponse } from "next/server";
import { getCurrentActor, getClientIp } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  uploadAttachment,
  UploadRejectedError,
} from "@/modules/attachments/service";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

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
  const { groupId } = await context.params;

  try {
    const actor = await getCurrentActor();
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

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    const env = getEnv();
    // Reject oversize bodies before buffering them.
    if (contentLength > env.UPLOAD_MAX_BYTES + 4096) {
      return NextResponse.json(
        { error: "That file is too large." },
        { status: 413 },
      );
    }

    const formData = await request.formData();
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
      return NextResponse.json({ error: error.message }, { status: 400 });
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
