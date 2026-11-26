// node --import tsx scripts/make-icons.ts
// One-off: draws the placeholder app icons (crimson square, white "BC") until the owner
// supplies a logo. The letters are SVG paths, so no system font is needed.
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CRIMSON = "#ac103d";
const SIZE = 512;
// The "BC" mark is drawn in a 330 × 200 box.
const MARK_W = 330;
const MARK_H = 200;
const MARK = `
  <g fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 17 V183" />
    <path d="M17 17 H75 A40 40 0 0 1 75 97 H17" />
    <path d="M17 97 H85 A43 43 0 0 1 85 183 H17" />
    <path d="M311 36 A83 83 0 1 0 311 164" />
  </g>`;

/** `markShare` = mark width as a share of the icon; `radius` = corner radius (0 = full bleed). */
function svg(markShare: number, radius: number): Buffer {
  const scale = (SIZE * markShare) / MARK_W;
  const x = (SIZE - MARK_W * scale) / 2;
  const y = (SIZE - MARK_H * scale) / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${radius}" fill="${CRIMSON}" />
  <g transform="translate(${x} ${y}) scale(${scale})">${MARK}</g>
</svg>`,
  );
}

async function render(source: Buffer, size: number, file: string, opaque = false): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true });
  let image = sharp(source, { density: 144 }).resize(size, size);
  if (opaque) image = image.flatten({ background: CRIMSON });
  await image.png({ compressionLevel: 9 }).toFile(file);
  console.log(`${file} (${size}×${size})`);
}

async function main(): Promise<void> {
  const rounded = svg(0.6, 96);
  // Maskable: full bleed, with the mark well inside the central 60% safe zone.
  const fullBleed = svg(0.48, 0);

  await render(rounded, 192, "public/icons/icon-192.png");
  await render(rounded, 512, "public/icons/icon-512.png");
  await render(fullBleed, 512, "public/icons/icon-maskable-512.png", true);
  await render(rounded, 256, "src/app/icon.png");
  // iOS rounds the corners itself and shows transparency as black.
  await render(svg(0.6, 0), 180, "src/app/apple-icon.png", true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
