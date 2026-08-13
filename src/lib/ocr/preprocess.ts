import {
  fitDetectionSize,
  measureLuminance,
  stretchContrast,
} from "./image-ops";

/**
 * Getting a photograph ready for the detector.
 *
 * Three things happen here, and each one exists for a specific failure:
 *
 *  - **EXIF orientation is applied.** A phone stores a portrait photo as
 *    landscape pixels plus a rotation flag. Ignore the flag and the receipt
 *    arrives sideways, where a horizontal-text detector finds nothing at all.
 *  - **The image is reduced before anything else touches it.** A 12 megapixel
 *    photo is 48 MB of RGBA, and the float32 tensor made from it would be
 *    another 145 MB. That allocation is what kills a Safari tab; doing it after
 *    the reduction never approaches the limit.
 *  - **Flat photographs are stretched, and only flat ones.** See
 *    `image-ops.ts`: contrast helps a picture taken in a dim restaurant and
 *    hurts one taken in daylight.
 *
 * Every intermediate — the decoded bitmap, the canvas — is released here
 * rather than left for the collector, because on iOS the collector is often
 * later than the next allocation.
 */

export interface PreparedImage {
  /** RGBA bytes, detached and ready to transfer to the worker. */
  readonly buffer: ArrayBuffer;
  readonly width: number;
  readonly height: number;
}

export class ImagePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImagePreparationError";
  }
}

/** Decodes with EXIF rotation applied where the browser supports saying so. */
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Older Safari rejects the options bag rather than ignoring it.
    try {
      return await createImageBitmap(file);
    } catch {
      throw new ImagePreparationError("unreadableImage");
    }
  }
}

/**
 * Reduces a photograph to the detector's working size and returns its pixels.
 *
 * `enhance` is left switchable so the two preprocessing paths can be compared
 * on real receipts without editing code.
 */
export async function prepareImage(
  file: Blob,
  options: { readonly enhance?: boolean } = {},
): Promise<PreparedImage> {
  const enhance = options.enhance ?? true;

  const bitmap = await decode(file);
  const target = fitDetectionSize(bitmap.width, bitmap.height);

  let image: ImageData;
  try {
    // OffscreenCanvas where it exists, a detached <canvas> otherwise: Safari
    // only shipped OffscreenCanvas in 16.4 and this runs on the main thread
    // anyway, where both are available.
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(target.width, target.height)
        : Object.assign(document.createElement("canvas"), {
            width: target.width,
            height: target.height,
          });

    const context = (canvas as HTMLCanvasElement).getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    if (!context) throw new ImagePreparationError("noCanvas");

    context.drawImage(bitmap, 0, 0, target.width, target.height);
    image = context.getImageData(0, 0, target.width, target.height);

    // Release the full-resolution decode as soon as it has been drawn.
    if (canvas instanceof HTMLCanvasElement) {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }

  const frame = {
    data: image.data,
    width: image.width,
    height: image.height,
  };

  if (enhance) {
    stretchContrast(frame, measureLuminance(frame));
  }

  return {
    buffer: image.data.buffer as ArrayBuffer,
    width: image.width,
    height: image.height,
  };
}
