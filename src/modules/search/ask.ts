import { z } from "zod";
import { config } from "@/lib/config";
import { dayInZone } from "@/lib/dates";
import type { Scope } from "@/modules/accounts/scope";
import { runToolLoop } from "@/modules/ai/tool-loop";
import type { Contact } from "@/modules/contacts/contact.schema";
import { getContactsByIds } from "@/modules/contacts/contacts.repo";
import { AppError } from "@/modules/shared/errors";
import { searchV1 } from "./prompts/search.v1";
import { finalAnswerTool, searchTools } from "./tools";

export const AskBody = z.object({ question: z.string() });

export const MAX_QUESTION = 500;

/** A question in plain English or Arabic → a one-line answer and the matching contacts. */
export async function ask(
  scope: Scope,
  question: string,
  today: Date = new Date(),
): Promise<{ answer: string; contacts: Contact[]; rounds: number }> {
  const text = question.trim();
  if (!text) throw new AppError("VALIDATION", "Type a question first.");
  if (text.length > MAX_QUESTION) {
    throw new AppError("VALIDATION", `The question is too long (over ${MAX_QUESTION} characters).`);
  }
  const { result, rounds } = await runToolLoop({
    prompt: searchV1,
    userText: `Today is ${dayInZone(today, config().APP_TIME_ZONE)}.\nQuestion: ${text}`,
    tools: searchTools(scope),
    final: finalAnswerTool,
    maxRounds: 3,
  });
  // The ids come from the model: only contacts inside the scope survive.
  const contacts = await getContactsByIds(scope, result.contactIds.slice(0, 50));
  return { answer: result.answer, contacts, rounds };
}
