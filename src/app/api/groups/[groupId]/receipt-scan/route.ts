import { NextResponse } from "next/server";
import { fileTypeFromBuffer } from "file-type";
import { getCurrentActor, getClientIp } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getOcrProvider, OcrProviderError } from "@/lib/ocr/providers";
import { serializeParsedReceipt } from "@/lib/ocr/serialize";

/**
 * Reading a receipt through the operator's configured provider.
 *
 * The same shape as the attachment upload beside it — authorization, then a
 * rate limit, then the work — with three differences that matter:
 *
 *  - **The image is not stored.** It is buffered, sent to the reader, and
 *    dropped. Keeping the photograph with the expense is a separate decision
 *    the user makes with a checkbox, and it goes through the attachment
 *    endpoint like it always has.
 *  - **The call is made here, not in the browser.** That is the only way the
 *    provider key stays on the server, and it means the page's
 *    `connect-src 'self'` never has to be widened.
 *  - **404 when no provider is configured.** An instance that never opted in
 *    should not advertise that the endpoint exists.
 *
 * What comes back is a `ParsedReceipt`, which the browser then validates and
 * puts in front of someone. Nothing here is trusted or stored.
 */

/**
 * Vision endpoints take pictures, so this one does too.
 *
 * A PDF never reaches here: `RemoteReader` reads its text layer on the device
 * when it has one, and draws its first page when it does not. What arrives is
 * always already an image, whatever the person picked.
 */
const READABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/receipt-scan">,
) {
  const { groupId } = await context.params;

  try {
    const provider = getOcrProvider();
    if (!provider) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const actor = await getCurrentActor();
    await authorizeGroup(actor, groupId, { requireActive: true });

    const limit = await consumeRateLimit("receiptScan", await getClientIp());
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many scans. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      );
    }

    const env = getEnv();
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > env.UPLOAD_MAX_BYTES + 4096) {
      return NextResponse.json(
        { error: "That image is too large." },
        { status: 413 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No image was sent." },
        { status: 400 },
      );
    }

    const currency = formData.get("currency");
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
      return NextResponse.json(
        { error: "A currency is required." },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "That image is empty." },
        { status: 400 },
      );
    }
    if (bytes.byteLength > env.UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        { error: "That image is too large." },
        { status: 413 },
      );
    }

    // Sniffed, never taken from the filename or the declared Content-Type —
    // the same rule the attachment service applies to the same bytes.
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected || !READABLE_TYPES.has(detected.mime)) {
      return NextResponse.json(
        { error: "That file is not a readable image." },
        { status: 400 },
      );
    }

    const receipt = await provider.read(bytes, detected.mime, {
      fallbackCurrency: currency.toUpperCase(),
      signal: request.signal,
    });

    return NextResponse.json({ receipt: serializeParsedReceipt(receipt) });
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

    /*
     * A provider failure is the operator's to fix, so it is logged with its
     * code and reported to the user as a code they can act on. The receipt
     * itself never reaches the log: `OcrProviderError` carries a fixed
     * message, and the raw reply — which is somebody's dinner — is not
     * attached to it anywhere.
     */
    if (error instanceof OcrProviderError) {
      logger.error(
        { provider: error.provider, code: error.code, groupId },
        "Receipt provider read failed",
      );
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.code === "rateLimit" ? 429 : 502 },
      );
    }

    logger.error(
      { err: error instanceof Error ? error.message : String(error), groupId },
      "Receipt scan failed",
    );
    return NextResponse.json(
      { error: "The receipt could not be read." },
      { status: 500 },
    );
  }
}
