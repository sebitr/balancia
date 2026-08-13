/**
 * Generates the PWA icon set from the Balancia mark.
 *
 * Run with `pnpm tsx scripts/generate-icons.ts` after changing the mark. The
 * output is committed so a build (and a Docker image) needs no image tooling.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Plum ground, cream ink, coral dot — the "app icon" tile on the brand page. */
const GROUND = "#2a0e31";
const INK = "#fbf7f1";
const DOT = "#f97361";

/**
 * The Balancia mark on its tile, sized for an icon canvas.
 *
 * The glyph geometry is the same as `BalanciaMark` in
 * `src/components/brand/wordmark.tsx` — keep the two in step.
 */
function markSvg(size: number, maskable: boolean): string {
  // Maskable icons must keep their content inside a safe circle of ~80%, so
  // the glyph sits smaller than on the tile that shows its own edge.
  const scale = maskable ? 0.4 : 0.515;
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  // A 22% rounded square, per the brand page. Maskable art is squared off and
  // the platform applies its own mask.
  const radius = maskable ? 0 : size * 0.22;
  // 1px keyline at 12% ink, so the tile keeps an edge on a dark home screen.
  const keyline = maskable
    ? ""
    : `\n  <rect x="${size * 0.0156}" y="${size * 0.0156}" width="${size * 0.969}" height="${size * 0.969}" rx="${size * 0.206}" fill="none" stroke="${INK}" stroke-opacity="0.12" stroke-width="${size * 0.0164}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${GROUND}"/>${keyline}
  <g transform="translate(${offset} ${offset}) scale(${glyph / 32})">
    <g transform="translate(2.4 2.6) scale(0.85)">
      <circle cx="16" cy="4.5" r="4.4" fill="${DOT}"/>
      <rect x="0" y="14.75" width="32" height="4.5" rx="2.25" fill="${INK}"/>
      <path d="M9.5 25a6.5 6.5 0 0 0 13 0Z" fill="${INK}"/>
    </g>
  </g>
</svg>`;
}

async function main(): Promise<void> {
  const outputDir = path.join(process.cwd(), "public", "icons");
  await mkdir(outputDir, { recursive: true });

  const targets: { name: string; size: number; maskable: boolean }[] = [
    { name: "icon-192.png", size: 192, maskable: false },
    { name: "icon-512.png", size: 512, maskable: false },
    { name: "icon-maskable-512.png", size: 512, maskable: true },
    { name: "apple-touch-icon.png", size: 180, maskable: false },
  ];

  for (const target of targets) {
    const png = await sharp(Buffer.from(markSvg(target.size, target.maskable)))
      .png()
      .toBuffer();
    await writeFile(path.join(outputDir, target.name), png);
    console.log(`Wrote public/icons/${target.name}`);
  }

  // Favicon as SVG: crisp at any size and needs no raster pipeline.
  await writeFile(
    path.join(process.cwd(), "public", "icon.svg"),
    markSvg(32, false),
  );
  console.log("Wrote public/icon.svg");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
