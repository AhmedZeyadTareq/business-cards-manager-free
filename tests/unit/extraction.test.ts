import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  detectImageType,
  MAX_AI_IMAGE_BYTES,
  prepareImage,
} from "@/modules/extraction/prepare-image";
import { extractPhotoV1 } from "@/modules/extraction/prompts/extract-photo.v1";
import { sectorRulesV1 } from "@/modules/extraction/prompts/sector-rules.v1";
import { structureTextV1 } from "@/modules/extraction/prompts/structure-text.v1";
import { searchV1 } from "@/modules/search/prompts/search.v1";
import { SECTORS } from "@/modules/contacts/contact.schema";

describe("prompts", () => {
  it("are versioned and carry the sector rules", () => {
    expect(structureTextV1.id).toBe("structure-text.v1");
    expect(extractPhotoV1.id).toBe("extract-photo.v1");
    expect(searchV1.id).toBe("search.v1");
    for (const prompt of [structureTextV1, extractPhotoV1, searchV1]) {
      expect(prompt.text).not.toContain("{SECTOR_RULES}");
      expect(prompt.text).toContain(sectorRulesV1.text);
    }
    for (const sector of SECTORS) expect(sectorRulesV1.text).toContain(`"${sector}"`);
  });

  it("match the wording in plan.md §9", () => {
    const plan = readFileSync("docs/plan.md", "utf8");
    expect(plan).toContain(sectorRulesV1.text);
    for (const prompt of [structureTextV1, extractPhotoV1, searchV1]) {
      const [before, after] = prompt.text.split(sectorRulesV1.text);
      expect(plan).toContain(before);
      expect(plan).toContain(after);
    }
  });
});

describe("prepareImage", () => {
  const png = () =>
    sharp({ create: { width: 3000, height: 1200, channels: 3, background: "#ac103d" } })
      .png()
      .toBuffer();

  it("detects the real type from the first bytes", async () => {
    expect(detectImageType(await png())).toBe("png");
    expect(detectImageType(readFileSync("tests/fixtures/photos/p01-1-english.jpg"))).toBe("jpeg");
    expect(
      detectImageType(
        await sharp(await png())
          .webp()
          .toBuffer(),
      ),
    ).toBe("webp");
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(16),
    ]);
    expect(detectImageType(heic)).toBe("heic");
    expect(detectImageType(Buffer.from("%PDF-1.7 not an image at all"))).toBeUndefined();
    expect(
      detectImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    ).toBeUndefined();
  });

  it("returns an upright JPEG no longer than 2000 px", async () => {
    const image = await prepareImage(await png());
    expect(image.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(image.data, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(800);
    expect(image.data.length).toBeLessThanOrEqual(MAX_AI_IMAGE_BYTES);
  });

  it("does not enlarge a small image and applies the EXIF rotation", async () => {
    const sideways = await sharp({
      create: { width: 400, height: 200, channels: 3, background: "#fff" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(Buffer.from((await prepareImage(sideways)).data, "base64")).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
  });

  it("refuses unknown and damaged files with a safe message", async () => {
    await expect(
      prepareImage(Buffer.from("this is a text file, not a photo")),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
      message: "Unsupported image. Use JPG, PNG, WEBP or HEIC.",
    });
    const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    await expect(prepareImage(damaged)).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA" });
  });
});
