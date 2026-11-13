import sharp from "sharp";
import type { JsonImage } from "@/modules/ai/call-json";
import { AppError } from "@/modules/shared/errors";

/** The largest base64 image sent to the model. Lower it if a model rejects large images. */
export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024;

// Tried in order until the base64 fits.
const STEPS = [
  { edge: 2000, quality: 85 },
  { edge: 2000, quality: 72 },
  { edge: 1600, quality: 72 },
  { edge: 1280, quality: 65 },
];

export type ImageType = "jpeg" | "png" | "webp" | "heic";

/** The real type from the file's first bytes. The browser's type is not trusted. */
export function detectImageType(buffer: Buffer): ImageType | undefined {
  if (buffer.length < 12) return undefined;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  if (buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "heic";
    }
  }
  return undefined;
}

const UNSUPPORTED = "Unsupported image. Use JPG, PNG, WEBP or HEIC.";

/** Any supported photo → an upright JPEG, small enough for the model, as base64. */
export async function prepareImage(buffer: Buffer): Promise<JsonImage> {
  const type = detectImageType(buffer);
  if (!type) throw new AppError("UNSUPPORTED_MEDIA", UNSUPPORTED);

  let input = buffer;
  try {
    if (type === "heic") {
      const { default: convert } = await import("heic-convert");
      input = Buffer.from(await convert({ buffer, format: "JPEG", quality: 0.92 }));
    }
    let data = "";
    for (const step of STEPS) {
      const jpeg = await sharp(input)
        .rotate() // upright, from EXIF
        .resize({ width: step.edge, height: step.edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: step.quality, mozjpeg: true })
        .toBuffer();
      data = jpeg.toString("base64");
      if (data.length <= MAX_AI_IMAGE_BYTES) break;
    }
    return { mediaType: "image/jpeg", data };
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A damaged file, or a format variant the decoder cannot read.
    throw new AppError(
      "UNSUPPORTED_MEDIA",
      "This image could not be read. Export it as JPG and try again.",
    );
  }
}
