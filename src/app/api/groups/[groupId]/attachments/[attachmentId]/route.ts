import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { downloadAttachment } from "@/modules/attachments/service";
import { ObjectNotFoundError } from "@/lib/storage";
import { logger } from "@/lib/logger";

/**
 * Receipt download.
 *
 * The only way to read an attachment: authorization runs on every request, the
 * lookup is scoped to the authorized group, and the response is served with
 * `Content-Disposition: attachment` plus a restrictive CSP so a PDF can never
 * execute in the app's origin. There is no publicly served uploads directory.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/groups/[groupId]/attachments/[attachmentId]">,
) {
  const { groupId, attachmentId } = await context.params;

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const file = await downloadAttachment(access, attachmentId);

    // RFC 5987 encoding keeps non-ASCII filenames intact without letting a
    // quote or newline break out of the header.
    const asciiName = file.fileName.replace(/[^\x20-\x7e]/g, "_");
    const encodedName = encodeURIComponent(file.fileName);

    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
        // Receipts are private: never cached by a shared proxy.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
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
      "Attachment download failed",
    );
    return NextResponse.json({ error: "Unavailable." }, { status: 500 });
  }
}
