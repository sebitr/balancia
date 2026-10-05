/**
 * The largest file Balancia can receive, and reading one without trusting the
 * request to say how large it is.
 *
 * `src/proxy.ts` runs in front of every route, and because it does, Next keeps
 * a copy of each request body so the proxy and the handler can both read it.
 * That copy stops at `experimental.proxyClientMaxBodySize` — ten megabytes
 * unless told otherwise — and it stops *silently*: the handler gets the first
 * ten megabytes, the stream ends as though that were all of it, and a
 * multipart parser fails on the truncated envelope with an error nobody can
 * act on. So the size that setting names is the real ceiling on an upload,
 * whatever `UPLOAD_MAX_BYTES` says, and it is fixed when the image is built.
 *
 * Both sides read it from here: `next.config.ts` sets the proxy's limit from
 * it, and `env.ts` refuses an `UPLOAD_MAX_BYTES` above it at boot, so an
 * operator who raises the setting past what the build can carry is told so
 * rather than finding out from a receipt that will not attach.
 *
 * No imports, on purpose: `next.config.ts` loads this file before anything
 * else in the application exists.
 */

/**
 * The most `UPLOAD_MAX_BYTES` may be set to: 25 MiB.
 *
 * A phone photo is a few megabytes before the browser re-encodes it and one or
 * two after; a scanned multi-page PDF can reach the teens. Twenty-five clears
 * both with room over. It is not higher because an upload is held in memory
 * several times over on its way to storage — the proxy's copy, the parsed
 * form, the buffer the type is sniffed from — and a small container notices a
 * few of those arriving at once.
 */
export const UPLOAD_CEILING_BYTES = 25 * 1024 * 1024;

/**
 * Room for the multipart envelope around the file: the boundaries, the
 * `Content-Disposition` line with its filename, the part's own
 * `Content-Type`, and any small field sent alongside, like the receipt
 * reader's currency.
 */
export const MULTIPART_ENVELOPE_BYTES = 4096;

/**
 * What the proxy is allowed to buffer, which has to be *more* than any upload
 * route will read.
 *
 * The margin is what makes a truncated body detectable. Node hands the body
 * over in chunks, and the proxy drops the whole chunk that crosses its limit,
 * so a cut-off body arrives short of the limit by up to a chunk. With a full
 * mebibyte between this and the most a route accepts, even the shortest
 * truncated body is still longer than that — and `readUploadForm` refuses it as
 * too large instead of parsing half a file.
 */
export const PROXY_BODY_LIMIT_BYTES = UPLOAD_CEILING_BYTES + 1024 * 1024;

/**
 * Reads a `multipart/form-data` upload whose file may be at most
 * `maxFileBytes`, or answers `null` when the request is larger than that.
 *
 * `Content-Length` is checked first, because refusing a declared size costs
 * nothing. It is not trusted, though: a chunked request declares no length at
 * all, and those used to sail past the check and into a parser that buffered
 * whatever arrived. So the body is counted as it is read, and reading stops
 * the moment it passes the limit — the same `null`, and the same 413 from the
 * route, whichever way the size was learned.
 */
export async function readUploadForm(
  request: Request,
  maxFileBytes: number,
): Promise<FormData | null> {
  const limit = maxFileBytes + MULTIPART_ENVELOPE_BYTES;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;

  const chunks: Uint8Array[] = [];
  if (request.body) {
    const reader = request.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  }

  // Parsed from the bytes already counted rather than from the request, whose
  // body has been read. The Content-Type carries the multipart boundary.
  return new Response(new Blob(chunks as BlobPart[]), {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
