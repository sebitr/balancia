/**
 * Reads a bounded amount of text from a response.
 *
 * `response.text()` will happily buffer whatever arrives, and a body is
 * whatever the other end decides to send. Both places that read one from a
 * server they do not control — an OCR provider's reply, a push service's
 * complaint — stop here at `maxBytes` instead, keep what fits, and cancel the
 * stream so the rest is never downloaded rather than downloaded and dropped.
 *
 * This bounds memory, not time. A body that trickles in one byte a minute is
 * stopped by the abort signal the request was made with: aborting a fetch
 * after its headers have arrived errors the body stream too, and the read
 * below rejects with it.
 */
export async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      // A chunk is however much the network delivered at once, often tens of
      // kilobytes, so the one that crosses the cap is cut rather than dropped:
      // a cap smaller than a chunk would otherwise read nothing at all.
      const kept = value.subarray(0, maxBytes - total);
      total += kept.byteLength;
      chunks.push(decoder.decode(kept, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return chunks.join("") + decoder.decode();
}
