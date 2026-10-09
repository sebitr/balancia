/**
 * What backups are called, and which of them retention may delete.
 *
 * Balancia deletes files in somebody's cloud account, which is not a thing to
 * do on a hunch. So the rule is narrow and written down: a name is a backup of
 * ours only if it matches the pattern below exactly, retention considers
 * nothing else, and it never deletes the newest `keepLast` of those. A file a
 * person put in the folder by hand, a README, last year's export from another
 * tool: none of them match, and none of them are touched.
 *
 * The timestamp is in the name, in UTC and sortable, rather than read from the
 * provider's modification time — which a copy, a restore from trash or a sync
 * client rewrites freely.
 */

/** A backup of the groups' data. */
const BUNDLE = /^balancia-backup-(\d{8}T\d{6}Z)\.json\.gz\.age$/;

function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function bundleName(at: Date): string {
  return `balancia-backup-${stamp(at)}.json.gz.age`;
}

/** When a backup was taken, from its name; null for anything that is not one of ours. */
export function parseBundleName(name: string): Date | null {
  const match = BUNDLE.exec(name);
  if (!match?.[1]) return null;
  const [, text] = match;
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9, 11)}:${text.slice(11, 13)}:${text.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A receipt, as a file. One per attachment, named for its id and for nothing
 * the person typed, so that the cloud learns neither what it was nor which
 * expense it belonged to.
 *
 * Receipts are never touched by retention. They are written once, shared by
 * every backup that mentions them, and a receipt that no backup mentions any
 * more is still a receipt somebody once kept.
 */
const RECEIPT =
  /^receipt-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.age$/;

export function receiptName(attachmentId: string): string {
  return `receipt-${attachmentId}.age`;
}

/** The attachment id a receipt file is named for; null for anything else. */
export function parseReceiptName(name: string): string | null {
  return RECEIPT.exec(name)?.[1] ?? null;
}

/**
 * The backups beyond the newest `keepLast`, oldest first — the ones retention
 * may delete. Names that are not ours never appear, whatever they look like.
 */
export function selectExpired(
  names: readonly string[],
  keepLast: number,
): string[] {
  if (!Number.isInteger(keepLast) || keepLast < 1) return [];
  const ours = names
    .filter((name) => BUNDLE.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return ours.slice(keepLast).reverse();
}
