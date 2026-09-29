/**
 * Redrawing a receipt photograph before it leaves the device, so it arrives
 * without its metadata.
 *
 * A phone writes an EXIF block into every photo it takes, and the block often
 * carries the GPS position the shutter was pressed at. A receipt photographed
 * at the kitchen table would otherwise hand the household's address to every
 * member of the group and to anybody holding its guest link. The server keeps
 * uploads byte for byte, so this is the one place the block can go.
 *
 * Drawing the decoded picture onto a canvas and encoding the canvas afresh
 * writes a file with pixels and nothing else. Three details make the redraw a
 * faithful one:
 *
 *  - **Orientation is applied first.** A portrait photo is stored as landscape
 *    pixels plus a rotation flag, and the flag goes with the rest of the EXIF
 *    block. `imageOrientation: "from-image"` bakes it into the pixels, or a
 *    receipt taken upright would arrive on its side.
 *  - **The long edge is capped at 2560 pixels, and never raised.** That keeps
 *    every line of a till receipt legible at full zoom, and holds a
 *    twelve-megapixel photo to well under half its pixels — which also spares
 *    the group's storage and the upload on a slow connection.
 *  - **Transparent pixels land on white.** JPEG has no alpha, and a WebP with
 *    some would otherwise come out black where it was clear.
 *
 * JPEG, WebP and HEIC are redrawn: they are what cameras write, and the ones
 * that carry a position. PNG, GIF and PDF go as they are — screenshots and
 * documents rather than photographs, and a PDF is not a picture at all.
 *
 * Every failure uploads the original. A browser that cannot decode the format
 * (HEIC anywhere but Safari), one that rejects the orientation option (older
 * Safari), a canvas that will not encode: none of them is a reason to lose the
 * receipt, and an unrotated redraw would be worse than none.
 */

/** Longest side of a redrawn photograph, in pixels. */
export const RECEIPT_MAX_EDGE = 2560;

/** Where small print on a photographed receipt stops visibly improving. */
const QUALITY = 0.9;

/** What the upload will send: the redrawn picture, or the original as it was. */
export interface PreparedReceipt {
  readonly file: Blob;
  readonly fileName?: string;
}

type Kind = "jpeg" | "webp" | "heic" | "other";

/**
 * What the file is, from its first bytes rather than its name or its declared
 * type — the same rule the server applies to the same bytes, and the only one
 * that holds for a file shared in from another app with no type at all.
 */
async function sniff(file: Blob): Promise<Kind> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.subarray(from, to));

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (
    ascii(4, 8) === "ftyp" &&
    ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(
      ascii(8, 12),
    )
  ) {
    return "heic";
  }
  return "other";
}

/** `IMG_2041.HEIC` becomes `IMG_2041.jpg`; a name with no extension gains one. */
function jpegName(fileName: string | undefined): string {
  const base = (fileName ?? "").replace(/\.[^./\\]*$/, "");
  return `${base || "receipt"}.jpg`;
}

export async function prepareReceiptForUpload(
  file: Blob,
  fileName?: string,
): Promise<PreparedReceipt> {
  const original: PreparedReceipt = { file, fileName };

  try {
    if ((await sniff(file)) === "other") return original;

    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });

    try {
      const scale = Math.min(
        1,
        RECEIPT_MAX_EDGE / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      if (!context) return original;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);

      const redrawn = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", QUALITY);
      });

      // Released now rather than whenever the collector gets to it: on a
      // phone, a full-size canvas is tens of megabytes.
      canvas.width = 0;
      canvas.height = 0;

      // A browser that cannot write JPEG hands back a PNG instead, which is
      // clean but several times the size. The original is the better upload.
      if (!redrawn || redrawn.type !== "image/jpeg") return original;

      return { file: redrawn, fileName: jpegName(fileName) };
    } finally {
      bitmap.close();
    }
  } catch {
    return original;
  }
}
