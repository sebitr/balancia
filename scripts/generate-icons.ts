/**
 * Generates the PWA icon set from the Balancia mark.
 *
 * Run with `pnpm tsx scripts/generate-icons.ts` after changing the mark. The
 * output is committed so a build (and a Docker image) needs no image tooling.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BRAND = "#2f6f74";
const BACKGROUND = "#f8f7f2";

/** The wordmark's balance glyph, sized for an icon canvas. */
function markSvg(size: number, maskable: boolean): string {
  // Maskable icons must keep their content inside a safe circle of ~80%.
  const scale = maskable ? 0.56 : 0.72;
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  const radius = maskable ? 0 : size * 0.22;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 32})">
    <path d="M16 5v22" stroke="${BRAND}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M6 11h20" stroke="${BRAND}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="7" cy="18" r="4.5" fill="${BRAND}" opacity="0.9"/>
    <circle cx="25" cy="18" r="4.5" fill="${BRAND}" opacity="0.55"/>
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
