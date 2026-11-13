import { z } from "zod";
import { config } from "@/lib/config";
import { AppError } from "@/modules/shared/errors";
import { chat, newDeadline, type ChatBody, type ChatMessage } from "./client";
import { describeIssues, parseJsonLoose, toProviderSchema } from "./json";

export type Prompt = { id: string; text: string };
export type JsonImage = { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };

export const JSON_MESSAGES = {
  tooLarge: "Input is too large for one request. Try fewer items at a time.",
  noRoom: "The AI ran out of room before answering. Tell an administrator.",
  declined: "The AI declined to process this input.",
  format: "The AI returned data in an unexpected format. Please try again.",
} as const;

/** `AI_JSON_MODE=schema`: response_format + the response-healing plugin. */
export function jsonResponseFormat(
  schema: z.ZodType,
): Pick<ChatBody, "response_format" | "plugins"> {
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "result",
        strict: true,
        schema: toProviderSchema(schema, { strict: true }),
      },
    },
    plugins: [{ id: "response-healing" }],
  };
}

/** `AI_JSON_MODE=prompt`: the schema is written into the prompt instead. */
export function jsonInstruction(schema: z.ZodType): string {
  return (
    "Reply with one JSON object only, no other text and no code fences. " +
    `It must match this JSON Schema:\n${JSON.stringify(toProviderSchema(schema, { strict: true }))}`
  );
}

/** Parses untrusted model text and validates it. Returns the problem as text on failure. */
export function readJson<S extends z.ZodType>(
  schema: S,
  content: string,
): { ok: true; value: z.infer<S> } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = parseJsonLoose(content);
  } catch {
    return { ok: false, problem: "the output was not valid JSON" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, problem: describeIssues(parsed.error) };
}

/**
 * One prompt → one validated object. The model's reply is untrusted text: it is parsed
 * loosely, validated with Zod, and corrected once if invalid.
 */
export async function callJson<S extends z.ZodType>(opts: {
  prompt: Prompt;
  input: string;
  schema: S;
  /** Present → AI_MODEL_VISION, absent → AI_MODEL_TEXT. */
  image?: JsonImage;
  /** Default AI_MAX_TOKENS; a larger value is cut to it. */
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const env = config();
  const deadline = newDeadline();
  const schemaMode = env.AI_JSON_MODE === "schema";

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: schemaMode
        ? opts.prompt.text
        : `${opts.prompt.text}\n\n${jsonInstruction(opts.schema)}`,
    },
    {
      role: "user",
      content: opts.image
        ? [
            { type: "text", text: opts.input },
            {
              type: "image_url",
              image_url: { url: `data:${opts.image.mediaType};base64,${opts.image.data}` },
            },
          ]
        : opts.input,
    },
  ];

  for (let attempt = 1; ; attempt++) {
    const result = await chat(
      {
        promptId: opts.prompt.id,
        model: opts.image ? env.AI_MODEL_VISION : env.AI_MODEL_TEXT,
        messages,
        max_tokens: opts.maxTokens,
        ...(schemaMode ? jsonResponseFormat(opts.schema) : {}),
      },
      deadline,
    );
    const content = result.message.content;

    // Neither of these is retried: the same request would end the same way.
    if (result.finishReason === "length") {
      throw new AppError(
        "AI_FAILED",
        content.trim() ? JSON_MESSAGES.tooLarge : JSON_MESSAGES.noRoom,
      );
    }
    if (result.finishReason === "content_filter") {
      throw new AppError("AI_FAILED", JSON_MESSAGES.declined);
    }

    const read = readJson(opts.schema, content);
    if (read.ok) return read.value;
    if (attempt >= 2) throw new AppError("AI_FAILED", JSON_MESSAGES.format);

    messages.push(
      { role: "assistant", content },
      {
        role: "user",
        content: `Your previous output failed validation: ${read.problem}. Return the complete corrected JSON.`,
      },
    );
  }
}
