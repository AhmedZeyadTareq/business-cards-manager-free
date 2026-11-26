import type { ObjectId } from "mongodb";
import { z } from "zod";
import { config } from "@/lib/config";
import { callJson } from "@/modules/ai/call-json";
import {
  AiContact,
  type ContactInput,
  type ReviewContact,
} from "@/modules/contacts/contact.schema";
import { findDuplicates } from "@/modules/contacts/contacts.repo";
import { cleanForReview, isEmptyContact } from "@/modules/contacts/normalize";
import { AppError } from "@/modules/shared/errors";
import { structureTextV1 } from "./prompts/structure-text.v1";

export const StructureTextBody = z.object({ text: z.string() });

const TextResult = z.object({ contacts: z.array(AiContact).max(200) });

/** The AI step alone, without the database: also used by `eval:text`. */
export async function extractContactsFromText(text: string): Promise<ContactInput[]> {
  const result = await callJson({
    prompt: structureTextV1,
    input: `<text>\n${text}\n</text>`,
    schema: TextResult,
  });
  return result.contacts.map(cleanForReview).filter((contact) => !isEmptyContact(contact));
}

/** Pasted text → suggested contacts for review. Nothing is saved here. */
export async function structureText(
  departmentId: ObjectId,
  text: string,
): Promise<{ contacts: ReviewContact[] }> {
  const trimmed = text.trim();
  if (!trimmed) throw new AppError("VALIDATION", "Paste some text first.");
  const max = config().MAX_TEXT_CHARS;
  if (trimmed.length > max) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `The text is too long (over ${max.toLocaleString("en")} characters). Paste it in smaller parts.`,
    );
  }
  const contacts = await extractContactsFromText(trimmed);
  return { contacts: await findDuplicates(departmentId, contacts) };
}
