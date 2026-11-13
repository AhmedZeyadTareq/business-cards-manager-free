import type { ObjectId } from "mongodb";
import { z } from "zod";
import { config } from "@/lib/config";
import { callJson, type JsonImage } from "@/modules/ai/call-json";
import {
  AiContact,
  type ContactInput,
  type ReviewContact,
} from "@/modules/contacts/contact.schema";
import { findDuplicates } from "@/modules/contacts/contacts.repo";
import { cleanForReview } from "@/modules/contacts/normalize";
import { AppError } from "@/modules/shared/errors";
import { prepareImage } from "./prepare-image";
import { extractPhotoV1 } from "./prompts/extract-photo.v1";

const PhotoResult = z.object({
  cardCount: z.number().int().min(0).max(50),
  contacts: z.array(AiContact).max(50),
});

/** The AI step alone, without the database: also used by `eval:photo`. */
export async function extractContactsFromPhoto(
  image: JsonImage,
): Promise<{ cardCount: number; contacts: ContactInput[] }> {
  const result = await callJson({
    prompt: extractPhotoV1,
    input: "Extract every business card in this photo.",
    schema: PhotoResult,
    image,
  });
  return { cardCount: result.cardCount, contacts: result.contacts.map(cleanForReview) };
}

/** A photo of cards → suggested contacts for review. Nothing is saved here. */
export async function extractPhoto(
  departmentId: ObjectId,
  file: { size: number; arrayBuffer: () => Promise<ArrayBuffer> } | null,
): Promise<{ cardCount: number; contacts: ReviewContact[]; warning?: string }> {
  if (!file || file.size === 0) throw new AppError("VALIDATION", "Choose a photo first.");
  const maxMb = config().MAX_IMAGE_MB;
  if (file.size > maxMb * 1024 * 1024) {
    throw new AppError("PAYLOAD_TOO_LARGE", `The photo is larger than ${maxMb} MB.`);
  }
  const image = await prepareImage(Buffer.from(await file.arrayBuffer()));
  const { cardCount, contacts } = await extractContactsFromPhoto(image);
  const result: { cardCount: number; contacts: ReviewContact[]; warning?: string } = {
    cardCount,
    contacts: await findDuplicates(departmentId, contacts),
  };
  if (cardCount !== contacts.length) {
    result.warning = `The AI counted ${cardCount} cards but read ${contacts.length}. Check the photo for missed cards.`;
  }
  return result;
}
