/**
 * Squaring a photograph in the browser, on the way to becoming an avatar.
 *
 * The crop is a centre crop of the shorter side, which is what every avatar
 * picker does and what people expect without being told: a portrait taken in
 * portrait keeps the face, a landscape keeps the middle. Offering a crop
 * rectangle to drag would be a screen of its own, and this design does not have
 * one.
 *
 * WebP at 512 because the largest place an avatar is drawn is 52 CSS pixels,
 * and 512 covers that at any device pixel ratio anyone has. Quality 0.86 is
 * where a photograph of a face stops visibly improving.
 *
 * `createImageBitmap` rather than an `<img>` and a load listener: it decodes
 * off the main thread, it honours EXIF orientation with
 * `imageOrientation: "from-image"` — a photo taken sideways would otherwise
 * arrive sideways, since the re-encode drops the tag that said so — and it
 * rejects rather than firing an error event, which is the shape the caller
 * wants.
 */

/** The side of the square that gets stored. */
const SIDE = 512;

/** Where a photograph of a face stops visibly improving. */
const QUALITY = 0.86;

/** A file the browser could not decode as an image at all. */
export class ImageDecodeError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("That file could not be read as an image.", options);
    this.name = "ImageDecodeError";
  }
}

export async function squareToWebp(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
  } catch (error) {
    throw new ImageDecodeError({ cause: error });
  }

  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const left = (bitmap.width - side) / 2;
    const top = (bitmap.height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;

    const context = canvas.getContext("2d");
    if (!context) throw new ImageDecodeError();

    // A photograph scaled down by a large factor aliases badly without this,
    // and the browser's own resampler is better than anything done by hand.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, left, top, side, side, 0, 0, SIDE, SIDE);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", QUALITY);
    });
    if (!blob) throw new ImageDecodeError();
    return blob;
  } finally {
    // The decoded bitmap can be tens of megabytes; a phone notices.
    bitmap.close();
  }
}
