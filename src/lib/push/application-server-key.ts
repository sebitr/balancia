/**
 * Decodes a VAPID public key for `PushManager.subscribe()`.
 *
 * The Push API also accepts the base64url string directly, but the
 * `BufferSource` form is what every engine in the support range has always
 * taken, and this path is only reached once per device.
 *
 * Deliberately free of server imports: both the settings page and the service
 * worker use it, and the service worker has no access to anything Node.
 */
export function applicationServerKey(
  base64Url: string,
): Uint8Array<ArrayBuffer> {
  const padded = base64Url.padEnd(
    base64Url.length + ((4 - (base64Url.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));

  // Allocated from an explicit ArrayBuffer so the result is not typed over the
  // possibly-shared buffer that `Uint8Array.from` would infer.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
