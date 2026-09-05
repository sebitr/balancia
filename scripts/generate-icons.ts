/**
 * Generates the PWA icon set from the Balancia mark.
 *
 * Run with `pnpm tsx scripts/generate-icons.ts` after changing the mark. The
 * output is committed so a build (and a Docker image) needs no image tooling.
 *
 * Output lands in two places, and the split matters:
 *
 *  - `public/icons/` holds the icons the web app manifest names by URL, so
 *    those paths have to stay stable and un-hashed.
 *  - `src/app/` holds `favicon.ico`, `icon.svg` and `apple-icon.png`. Next.js
 *    only links icons into `<head>` for files matching its app-icons
 *    convention inside the app directory — a copy in `public/` is served but
 *    never referenced, which is exactly how the stock scaffold favicon
 *    survived here unnoticed.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MARK, palette } from "@/modules/auth/emails/tokens";
import { themeColorFor } from "@/modules/profile/surface";

/**
 * Plum ground, cream ink, coral dot — the "app icon" tile on the brand page.
 *
 * Derived rather than transcribed. They used to be three hand-written hexes,
 * and the dot had already drifted a unit off coral.
 */
const GROUND = palette.ink;
const INK = themeColorFor("cream");
const DOT = palette.primary;

/**
 * How the mark is placed on its tile.
 *
 *  - `tile` is the home-screen icon: generous margin, rounded corners and a
 *    keyline, because it shows its own edge against the wallpaper.
 *  - `maskable` keeps the glyph inside the ~80% safe circle Android crops to,
 *    and squares off the corners so the platform can apply its own mask.
 *  - `compact` is for browser-tab sizes. The brand notes warn the rule and pan
 *    merge below 20px, so the glyph is pushed out to the edge of the tile and
 *    the keyline dropped — at 16px every pixel of margin costs legibility.
 *  - `email` is the mark alone on a transparent ground, for the header bar of
 *    the transactional emails — which cannot use the inline SVG the interface
 *    uses, because Gmail and Outlook drop inline SVG. It takes its colours
 *    from the email palette, which is derived from the theme tokens — the
 *    same place the three constants above now come from.
 */
type Variant = "tile" | "maskable" | "compact" | "badge" | "email";

const LAYOUT: Record<Variant, { scale: number; radius: number }> = {
  tile: { scale: 0.515, radius: 0.22 },
  maskable: { scale: 0.4, radius: 0 },
  compact: { scale: 0.78, radius: 0.16 },
  badge: { scale: 0.86, radius: 0 },
  email: { scale: 1, radius: 0 },
};

/**
 * The Balancia mark on its tile, sized for an icon canvas.
 *
 * The glyph geometry is the same as `BalanciaMark` in
 * `src/components/brand/wordmark.tsx` — keep the two in step.
 */
/**
 * Trims a coordinate for output. `icon.svg` is committed and read by humans,
 * and the raw arithmetic here produces things like `3.5199999999999996`.
 */
function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function markSvg(size: number, variant: Variant): string {
  const { scale, radius } = LAYOUT[variant];
  const glyph = size * scale;
  const offset = (size - glyph) / 2;

  // Android draws the notification badge as a mask: it keeps the alpha channel
  // and throws the colours away. So the badge is the glyph in flat white on a
  // transparent ground — any tile or colour here would come out as a blob.
  if (variant === "badge") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${n(offset)} ${n(offset)}) scale(${n(glyph / 32)})">
    <g transform="translate(2.4 2.6) scale(0.85)">
      <circle cx="16" cy="4.5" r="4.4" fill="#ffffff"/>
      <rect x="0" y="14.75" width="32" height="4.5" rx="2.25" fill="#ffffff"/>
      <path d="M9.5 25a6.5 6.5 0 0 0 13 0Z" fill="#ffffff"/>
    </g>
  </g>
</svg>`;
  }

  // The mark alone, on nothing. It sits on the plum header bar of an email,
  // so the rule and pan take the cream the wordmark beside them uses, and the
  // ground stays transparent rather than being baked in — a client that shifts
  // that bar for dark mode then carries the glyph with it.
  if (variant === "email") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${n(offset)} ${n(offset)}) scale(${n(glyph / 32)})">
    <g transform="translate(2.4 2.6) scale(0.85)">
      <circle cx="16" cy="4.5" r="4.4" fill="${palette.primary}"/>
      <rect x="0" y="14.75" width="32" height="4.5" rx="2.25" fill="${palette.wrapper}"/>
      <path d="M9.5 25a6.5 6.5 0 0 0 13 0Z" fill="${palette.wrapper}"/>
    </g>
  </g>
</svg>`;
  }

  // 1px keyline at 12% ink, so the tile keeps an edge on a dark home screen.
  const keyline =
    variant === "tile"
      ? `\n  <rect x="${n(size * 0.0156)}" y="${n(size * 0.0156)}" width="${n(size * 0.969)}" height="${n(size * 0.969)}" rx="${n(size * 0.206)}" fill="none" stroke="${INK}" stroke-opacity="0.12" stroke-width="${n(size * 0.0164)}"/>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${n(size * radius)}" fill="${GROUND}"/>${keyline}
  <g transform="translate(${n(offset)} ${n(offset)}) scale(${n(glyph / 32)})">
    <g transform="translate(2.4 2.6) scale(0.85)">
      <circle cx="16" cy="4.5" r="4.4" fill="${DOT}"/>
      <rect x="0" y="14.75" width="32" height="4.5" rx="2.25" fill="${INK}"/>
      <path d="M9.5 25a6.5 6.5 0 0 0 13 0Z" fill="${INK}"/>
    </g>
  </g>
</svg>`;
}

/** Renders the tile to a PNG buffer at one size. */
function renderPng(size: number, variant: Variant): Promise<Buffer> {
  return sharp(Buffer.from(markSvg(size, variant)))
    .png()
    .toBuffer();
}

/**
 * Packs PNGs into an `.ico` container.
 *
 * sharp cannot write ICO, and the format is small enough that a dependency
 * would cost more than it saves: a 6-byte header, a 16-byte directory entry
 * per image, then the payloads. Storing PNG rather than BMP inside the
 * container is the Vista-era form that every browser in our support range
 * reads.
 */
function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const HEADER_BYTES = 6;
  const ENTRY_BYTES = 16;

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER_BYTES + ENTRY_BYTES * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(ENTRY_BYTES);
    // A 0 byte means 256px; every size we ship is smaller than that.
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([
    header,
    ...entries,
    ...images.map((image) => image.png),
  ]);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const iconsDir = path.join(root, "public", "icons");
  const appDir = path.join(root, "src", "app");
  await mkdir(iconsDir, { recursive: true });

  // Named by the manifest, so these filenames are load-bearing.
  const manifestIcons: { name: string; size: number; variant: Variant }[] = [
    { name: "icon-192.png", size: 192, variant: "tile" },
    { name: "icon-512.png", size: 512, variant: "tile" },
    { name: "icon-maskable-512.png", size: 512, variant: "maskable" },
    // Referenced by the service worker's push handler, not by the manifest.
    { name: "badge-72.png", size: 72, variant: "badge" },
  ];

  for (const target of manifestIcons) {
    await writeFile(
      path.join(iconsDir, target.name),
      await renderPng(target.size, target.variant),
    );
    console.log(`Wrote public/icons/${target.name}`);
  }

  // The transactional emails' header mark, at 2× for its 24px slot. Served
  // from the instance's own origin, so the path is load-bearing: it is built
  // into every message this instance has ever sent. See emails/tokens.ts.
  const emailDir = path.join(root, "public", "email");
  await mkdir(emailDir, { recursive: true });
  await writeFile(
    path.join(emailDir, path.basename(MARK.path)),
    await renderPng(MARK.width * 2, "email"),
  );
  console.log(`Wrote public${MARK.path}`);

  // iOS home screen. Safari ignores the manifest icons and takes this one.
  await writeFile(
    path.join(appDir, "apple-icon.png"),
    await renderPng(180, "tile"),
  );
  console.log("Wrote src/app/apple-icon.png");

  // Browser tab, for anything that understands an SVG icon: crisp at any size.
  await writeFile(path.join(appDir, "icon.svg"), markSvg(32, "compact"));
  console.log("Wrote src/app/icon.svg");

  // The .ico fallback still matters — Safari, and anything fetching
  // /favicon.ico directly without parsing the document, only take this one.
  const icoSizes = [16, 32, 48];
  await writeFile(
    path.join(appDir, "favicon.ico"),
    encodeIco(
      await Promise.all(
        icoSizes.map(async (size) => ({
          size,
          png: await renderPng(size, "compact"),
        })),
      ),
    ),
  );
  console.log(`Wrote src/app/favicon.ico (${icoSizes.join(", ")}px)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
