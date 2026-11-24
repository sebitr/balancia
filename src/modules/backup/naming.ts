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
 * ## Whose backup it is
 *
 * Matching the pattern says a file is *a* Balancia backup, not that it is
 * *this destination's*. Every destination writes into `Balancia Backups` under
 * whatever folder or prefix it was given, and that is often the same place: two
 * owners sharing a bucket, one owner's second destination pointed at the first
 * one's folder, two installations backing up to one Nextcloud. While names were
 * only a timestamp, each took the other's files for its own, deleted them as
 * "beyond the newest ten", offered them on its restore list, and two writes in
 * the same second overwrote each other.
 *
 * So each name carries the **tag** of the destination that wrote it — the first
 * twelve hex digits of its id, which is random and never changes — and
 * retention considers only files with its own tag. A file written before tags
 * existed ("legacy") is deleted only when this destination's own run history
 * names it as one it wrote, and no other destination's history names it too: a
 * file it cannot prove is its own, it leaves alone.
 *
 * The timestamp is in the name, in UTC and sortable, rather than read from the
 * provider's modification time — which a copy, a restore from trash or a sync
 * client rewrites freely.
 */

/** A backup of the groups' data, tagged by the destination that wrote it. */
const BUNDLE = /^balancia-backup-([0-9a-f]{12})-(\d{8}T\d{6}Z)\.json\.gz\.age$/;
/** The same, as written before names carried a tag. Read, never written. */
const LEGACY_BUNDLE = /^balancia-backup-(\d{8}T\d{6}Z)\.json\.gz\.age$/;

const TAG = /^[0-9a-f]{12}$/;

/**
 * The tag a destination signs its files with: the first twelve hex digits of
 * its id. Destination ids are random UUIDs, so two destinations sharing a
 * folder have one chance in 2^48 of sharing a tag, and the tag says nothing
 * about the person or their groups.
 */
export function destinationTag(destinationId: string): string {
  const tag = destinationId.toLowerCase().replace(/-/g, "").slice(0, 12);
  if (!TAG.test(tag)) throw new Error("A destination id is a UUID.");
  return tag;
}

function stamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function bundleName(at: Date, tag: string): string {
  if (!TAG.test(tag)) throw new Error("Not a destination tag.");
  return `balancia-backup-${tag}-${stamp(at)}.json.gz.age`;
}

export interface ParsedBundle {
  readonly takenAt: Date;
  /** The destination that wrote it; null for a name from before tags. */
  readonly tag: string | null;
}

function parseStamp(text: string): Date | null {
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9, 11)}:${text.slice(11, 13)}:${text.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A backup's name taken apart, in either form; null for anything that is not one of ours. */
export function parseBundle(name: string): ParsedBundle | null {
  const tagged = BUNDLE.exec(name);
  if (tagged?.[1] && tagged[2]) {
    const takenAt = parseStamp(tagged[2]);
    return takenAt ? { takenAt, tag: tagged[1] } : null;
  }
  const legacy = LEGACY_BUNDLE.exec(name);
  if (legacy?.[1]) {
    const takenAt = parseStamp(legacy[1]);
    return takenAt ? { takenAt, tag: null } : null;
  }
  return null;
}

/** When a backup was taken, from its name; null for anything that is not one of ours. */
export function parseBundleName(name: string): Date | null {
  return parseBundle(name)?.takenAt ?? null;
}

/**
 * Whether a destination may offer a file on its restore list and hand it out.
 *
 * Its own tagged files, and any legacy one. Legacy files were written before
 * names said whose they were, and hiding them could hide the owner's only
 * copies of the weeks before the change. Offering one hands out nothing that a
 * person holding these credentials could not download from their cloud anyway,
 * and it opens only with the key that made it. Another destination's tagged
 * files are not offered.
 */
export function isListedBy(name: string, tag: string): boolean {
  const parsed = parseBundle(name);
  return parsed !== null && (parsed.tag === null || parsed.tag === tag);
}

/**
 * A receipt, as a file. One per attachment and recovery key, named for the
 * attachment's id, the key's fingerprint and nothing the person typed, so that
 * the cloud learns neither what it was nor which expense it belonged to.
 *
 * The fingerprint is in the name because a receipt is sent once and then
 * referred to by every later backup. While the name was the attachment's id
 * alone, a receipt sent under a key the owner had since replaced went on being
 * listed by every backup made under the new one, which the new key cannot
 * open. Now a new key finds none of its own receipts there, sends each again,
 * and its backups list those.
 *
 * Receipts are never touched by retention. They are written once, shared by
 * every backup that mentions them, and a receipt that no backup mentions any
 * more is still a receipt somebody once kept — and the backups made under the
 * old key still list the old copies.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RECEIPT = new RegExp(`^receipt-(${UUID})-([0-9a-f]{8})\\.age$`);
/** As written before names carried the key: still read, never written. */
const LEGACY_RECEIPT = new RegExp(`^receipt-(${UUID})\\.age$`);

const FINGERPRINT = /^[0-9a-f]{8}$/;

export function receiptName(attachmentId: string, fingerprint: string): string {
  if (!FINGERPRINT.test(fingerprint)) throw new Error("Not a key fingerprint.");
  return `receipt-${attachmentId}-${fingerprint}.age`;
}

export interface ParsedReceipt {
  readonly attachmentId: string;
  /**
   * The recovery key it was encrypted to, by fingerprint. Null for a name from
   * before that was recorded, which could have been written under any key the
   * owner has had.
   */
  readonly fingerprint: string | null;
}

/** A receipt's name taken apart, in either form; null for anything else. */
export function parseReceipt(name: string): ParsedReceipt | null {
  const keyed = RECEIPT.exec(name);
  if (keyed?.[1] && keyed[2]) {
    return { attachmentId: keyed[1], fingerprint: keyed[2] };
  }
  const legacy = LEGACY_RECEIPT.exec(name);
  if (legacy?.[1]) return { attachmentId: legacy[1], fingerprint: null };
  return null;
}

export interface Ownership {
  /** This destination's tag. Its tagged files are its own. */
  readonly tag: string;
  /**
   * Legacy (untagged) names this destination's run history says it wrote, and
   * no other destination's says the same. The only legacy files it may delete.
   */
  readonly legacyOwned?: ReadonlySet<string>;
}

/**
 * The backups beyond the newest `keepLast`, oldest first — the ones retention
 * may delete. Only this destination's own files are counted or offered: names
 * that are not ours, another destination's, and legacy files it cannot prove
 * it wrote never appear, whatever they look like.
 */
export function selectExpired(
  names: readonly string[],
  keepLast: number,
  owner: Ownership,
): string[] {
  if (!Number.isInteger(keepLast) || keepLast < 1) return [];
  if (!TAG.test(owner.tag)) return [];
  const legacyOwned = owner.legacyOwned ?? new Set<string>();
  const ours: { name: string; at: number }[] = [];
  for (const name of new Set(names)) {
    const parsed = parseBundle(name);
    if (!parsed) continue;
    const own =
      parsed.tag === null ? legacyOwned.has(name) : parsed.tag === owner.tag;
    if (own) ours.push({ name, at: parsed.takenAt.getTime() });
  }
  ours.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1));
  return ours
    .slice(keepLast)
    .reverse()
    .map((entry) => entry.name);
}
