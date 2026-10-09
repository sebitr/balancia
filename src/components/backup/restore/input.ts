/**
 * What the restore screen accepts from the person, before anything is opened.
 *
 * No React and no network in this file, on purpose: the recovery key passes
 * through it, and the cheapest way to show that nothing here can send it
 * anywhere is that nothing here can send anything.
 */

/**
 * The largest file the screen will read into memory.
 *
 * A backup is JSON, gzipped, then encrypted: a busy account is a few hundred
 * kilobytes, and one with years of history a few tens of megabytes. 300 MB is
 * a ceiling well above any of those that still keeps a wrong click (a disk
 * image, a video) from freezing a phone's browser while it is read.
 */
export const MAX_BACKUP_BYTES = 300 * 1024 * 1024;

/** A key file is three lines. Nothing larger is one, and nothing larger is read. */
export const MAX_KEY_FILE_BYTES = 64 * 1024;

/**
 * An age identity: `AGE-SECRET-KEY-1…`, or `AGE-SECRET-KEY-PQ-1…` for the
 * post-quantum kind that `age-keygen -pq` writes, which "Use my own key" lets
 * somebody bring. The body is Bech32, so letters and digits and nothing else.
 */
const IDENTITY = /AGE-SECRET-KEY-(?:PQ-)?1[0-9A-Z]+/i;

/**
 * The recovery key inside whatever the person gave us, or null.
 *
 * `age-keygen` writes a file of comment lines and the key on the last one:
 *
 *     # created: 2026-10-09T03:30:12Z
 *     # public key: age1…
 *     AGE-SECRET-KEY-1…
 *
 * and people paste the whole file as readily as the one line, with the
 * newlines a text box swallows leaving the comments glued to the key. So the
 * key is found rather than assumed to be the whole text. It is returned in
 * upper case, which is how age writes it: Bech32 allows either case but not a
 * mixture, and the library only recognises the upper one.
 */
export function extractKey(text: string): string | null {
  const found = IDENTITY.exec(text);
  return found ? found[0].toUpperCase() : null;
}
