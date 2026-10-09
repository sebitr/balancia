/**
 * Hands a string to the browser as a downloaded file.
 *
 * A Blob and an `a[download]`, because the text exists only in this tab's
 * memory: there is no URL a server could serve it from, and there must not be.
 * The object URL is revoked once the browser has had time to start the
 * download. Immediately would be enough in Chrome and Firefox, but Safari
 * resolves the URL a moment after the click and finds nothing.
 */
export function saveTextFile(
  fileName: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
