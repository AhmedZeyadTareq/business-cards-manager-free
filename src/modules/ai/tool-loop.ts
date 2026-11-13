import { z } from "zod";
import { config } from "@/lib/config";
import { AppError } from "@/modules/shared/errors";
import { jsonInstruction, jsonResponseFormat, readJson, type Prompt } from "./call-json";
import { chat, newDeadline, type ChatMessage, type ToolDefinition } from "./client";
import { describeIssues, toProviderSchema } from "./json";

export type LoopTool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<unknown>;
};

export type FinalTool<S extends z.ZodType> = { name: string; description: string; schema: S };

/** Keeps the inference from a tool's schema to its handler. */
export function defineTool<S extends z.ZodType>(tool: LoopTool<S>): LoopTool {
  return tool as unknown as LoopTool;
}

export type LoopCall = { name: string; input: unknown; error?: string };

export const LOOP_FAILED = "AI search did not finish. Try rephrasing the question.";

function definition(tool: {
  name: string;
  description: string;
  schema: z.ZodType;
}): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      // Never strict: optional fields must stay optional.
      parameters: toProviderSchema(tool.schema, { strict: false }),
    },
  };
}

/**
 * A bounded tool loop (Ask AI). A round is one chat() call. The model may call the
 * tools for maxRounds − 1 rounds; the last round must give the final answer as JSON.
 */
export async function runToolLoop<F extends z.ZodType>(opts: {
  prompt: Prompt;
  userText: string;
  tools: LoopTool[];
  final: FinalTool<F>;
  maxRounds?: number;
}): Promise<{ result: z.infer<F>; rounds: number; calls: LoopCall[] }> {
  const env = config();
  const maxRounds = Math.max(opts.maxRounds ?? 3, 1);
  const deadline = newDeadline();
  const schemaMode = env.AI_JSON_MODE === "schema";
  const tools = [...opts.tools.map(definition), definition(opts.final)];
  const calls: LoopCall[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: opts.prompt.text },
    { role: "user", content: opts.userText },
  ];

  for (let round = 1; round <= maxRounds; round++) {
    const last = round === maxRounds;
    if (last) {
      messages.push({
        role: "user",
        content: schemaMode
          ? "Give the final answer now as JSON only."
          : `Give the final answer now as JSON only. ${jsonInstruction(opts.final.schema)}`,
      });
    }
    const result = await chat(
      {
        promptId: opts.prompt.id,
        model: env.AI_MODEL_TEXT,
        messages,
        tools,
        tool_choice: last ? "none" : "auto",
        ...(last && schemaMode ? jsonResponseFormat(opts.final.schema) : {}),
      },
      deadline,
    );
    const { content, tool_calls: toolCalls } = result.message;

    // A valid final-tool call ends the loop, even next to other calls and in the last round.
    for (const call of toolCalls) {
      if (call.function.name !== opts.final.name) continue;
      const read = readJson(opts.final.schema, call.function.arguments);
      if (read.ok) return { result: read.value, rounds: round, calls };
    }

    // The model's text may itself be the final answer (prose-wrapped or plain JSON).
    if (toolCalls.length === 0 || last) {
      const read = readJson(opts.final.schema, content);
      if (read.ok) return { result: read.value, rounds: round, calls };
      if (last) break;
      messages.push(
        { role: "assistant", content },
        { role: "user", content: `Finish by calling ${opts.final.name}.` },
      );
      continue;
    }

    // Push the assistant turn back unchanged, then one tool message per call.
    messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls });
    const answers = await Promise.all(
      toolCalls.map(async (call) => {
        const answer = await runCall(call.function.name, call.function.arguments, opts, calls);
        return { role: "tool" as const, tool_call_id: call.id, content: answer };
      }),
    );
    messages.push(...answers);
  }

  throw new AppError("AI_FAILED", LOOP_FAILED);
}

/** Runs one tool call. Every problem becomes an error sentence for the model. */
async function runCall(
  name: string,
  rawArguments: string,
  opts: { tools: LoopTool[]; final: { name: string; schema: z.ZodType } },
  calls: LoopCall[],
): Promise<string> {
  const record = (input: unknown, error?: string) => {
    calls.push(error ? { name, input, error } : { name, input });
    return error ?? "";
  };

  let input: unknown;
  try {
    input = rawArguments.trim() === "" ? {} : JSON.parse(rawArguments);
  } catch {
    return record(rawArguments, "Invalid input: the arguments were not valid JSON.");
  }

  if (name === opts.final.name) {
    const parsed = opts.final.schema.safeParse(input);
    const problem = parsed.success ? "unknown" : describeIssues(parsed.error);
    return record(input, `Invalid input: ${problem}`);
  }
  const tool = opts.tools.find((candidate) => candidate.name === name);
  if (!tool) return record(input, `Unknown tool: ${name}.`);

  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return record(input, `Invalid input: ${describeIssues(parsed.error)}`);
  try {
    const output = await tool.run(parsed.data);
    record(parsed.data);
    return JSON.stringify(output);
  } catch {
    return record(parsed.data, "The search failed. Try different parameters.");
  }
}
