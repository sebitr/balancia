/**
 * How an attachment describes itself under its own name: "PDF · 142 kB".
 *
 * Pure, and kept out of the component beside it, because both halves are
 * decisions rather than markup — which of three words names the file, and
 * where the line between kilobytes and megabytes falls.
 */

export type FileKind = "image" | "pdf" | "file";

/**
 * What to call the file.
 *
 * Three buckets and no more: the MIME type of a receipt is either a picture of
 * one, a PDF of one, or something the reader will recognise from the filename
 * anyway. Naming the long-form subtype ("Portable Network Graphics") would be
 * accurate and useless.
 */
export function fileKindOf(contentType: string): FileKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  return "file";
}

export interface FileSize {
  readonly unit: "kilobytes" | "megabytes";
  /** Already rounded for display; the catalogue supplies the unit's word. */
  readonly size: number;
}

/**
 * Kilobytes below a megabyte, megabytes above, both decimal.
 *
 * Decimal rather than binary units, matching every file manager the reader has
 * ever seen, and rounded — nobody checks a receipt to the byte. The floor of
 * 1 kB is what stops a small file reading as "0 kB", which looks like a failed
 * upload rather than a small one.
 */
export function fileSizeOf(bytes: bigint): FileSize {
  const kilobytes = Number(bytes) / 1000;
  if (kilobytes < 1000) {
    return { unit: "kilobytes", size: Math.max(1, Math.round(kilobytes)) };
  }
  // One decimal place: "1.4 MB" is the difference a reader is looking for
  // between two receipts, and "1.42" is not.
  return { unit: "megabytes", size: Math.round(kilobytes / 100) / 10 };
}
