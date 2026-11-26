import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineTool, runToolLoop } from "@/modules/ai/tool-loop";
import { completion, mockFetch, setEnv, settle } from "./ai-helpers";

const prompt = { id: "search.test", text: "Find contacts." };
const final = {
  name: "final_answer",
  description: "Give the final answer.",
  schema: z.object({ answer: z.string(), contactIds: z.array(z.string()) }),
};

function makeTools() {
  const seen: unknown[] = [];
  const tools = [
    defineTool({
      name: "search_contacts",
      description: "Search.",
      schema: z.object({ text: z.string().optional(), limit: z.number().int().max(20).optional() }),
      run: async (input) => {
        seen.push(input);
        if (input.text === "boom") throw new Error("database exploded: secret detail");
        return { count: 1, results: [{ id: "id1", FullName: "Ali" }] };
      },
    }),
  ];
  return { tools, seen };
}

const run = (tools: ReturnType<typeof makeTools>["tools"], maxRounds?: number) =>
  settle(runToolLoop({ prompt, userText: "Question: who?", tools, final, maxRounds }));

type Message = {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
};
const messagesOf = (sent: { body: Record<string, unknown> }) => sent.body.messages as Message[];

beforeEach(() => {
  vi.useFakeTimers();
  setEnv({ AI_MODEL_TEXT: "text/model:free" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runToolLoop", () => {
  it("runs several tool calls of one turn, then accepts final_answer", async () => {
    const { tools, seen } = makeTools();
    const { sent } = mockFetch([
      completion(null, {
        toolCalls: [
          { name: "search_contacts", args: { text: "ali" }, id: "a" },
          { name: "search_contacts", args: { text: "علي" }, id: "b" },
        ],
      }),
      completion(null, {
        toolCalls: [{ name: "final_answer", args: { answer: "Ali.", contactIds: ["id1"] } }],
      }),
    ]);
    const out = await run(tools);
    expect(out.result).toEqual({ answer: "Ali.", contactIds: ["id1"] });
    expect(out.rounds).toBe(2);
    expect(out.calls).toEqual([
      { name: "search_contacts", input: { text: "ali" } },
      { name: "search_contacts", input: { text: "علي" } },
    ]);
    expect(seen).toHaveLength(2);

    // Round 1 request: tools in function format, auto choice, non-strict parameters.
    const first = sent[0].body as Record<string, never>;
    expect(first.tool_choice).toBe("auto");
    expect(
      (first.tools as { function: { name: string } }[]).map((tool) => tool.function.name),
    ).toEqual(["search_contacts", "final_answer"]);
    const parameters = (first.tools as { function: { parameters: Record<string, unknown> } }[])[0]
      .function.parameters;
    expect(parameters.required ?? []).toEqual([]);
    expect(parameters).not.toHaveProperty("additionalProperties");
    expect(first).not.toHaveProperty("response_format");

    // Round 2 request: the assistant turn unchanged, then one tool message per call.
    const messages = messagesOf(sent[1]);
    expect(messages[2].role).toBe("assistant");
    expect(messages[2].tool_calls).toHaveLength(2);
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: "a" });
    expect(messages[4]).toMatchObject({ role: "tool", tool_call_id: "b" });
    expect(JSON.parse(messages[3].content!)).toEqual({
      count: 1,
      results: [{ id: "id1", FullName: "Ali" }],
    });
  });

  it("answers unparseable arguments, bad input, unknown tools and failing handlers as error text", async () => {
    const { tools, seen } = makeTools();
    const { sent } = mockFetch([
      completion(null, {
        toolCalls: [
          { name: "search_contacts", args: "{not json", id: "a" },
          { name: "search_contacts", args: { limit: 500 }, id: "b" },
          { name: "delete_everything", args: {}, id: "c" },
          { name: "search_contacts", args: { text: "boom" }, id: "d" },
        ],
      }),
      completion(null, {
        toolCalls: [{ name: "final_answer", args: { answer: "None.", contactIds: [] } }],
      }),
    ]);
    const out = await run(tools);
    const answers = messagesOf(sent[1])
      .filter((message) => message.role === "tool")
      .map((message) => message.content);
    expect(answers[0]).toBe("Invalid input: the arguments were not valid JSON.");
    expect(answers[1]).toMatch(/^Invalid input: limit: /);
    expect(answers[2]).toBe("Unknown tool: delete_everything.");
    expect(answers[3]).toBe("The search failed. Try different parameters.");
    expect(JSON.stringify(sent[1].body)).not.toContain("secret detail");
    expect(seen).toEqual([{ text: "boom" }]);
    expect(out.calls.map((call) => Boolean(call.error))).toEqual([true, true, true, true]);
    expect(out.result.contactIds).toEqual([]);
  });

  it("an early final answer ends the loop, even next to other calls", async () => {
    const { tools, seen } = makeTools();
    const { sent } = mockFetch([
      completion(null, {
        toolCalls: [
          { name: "search_contacts", args: { text: "x" } },
          { name: "final_answer", args: { answer: "Done.", contactIds: ["id9"] } },
        ],
      }),
    ]);
    const out = await run(tools);
    expect(out).toMatchObject({ rounds: 1, result: { answer: "Done.", contactIds: ["id9"] } });
    expect(sent).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("accepts a prose turn that contains a valid final answer", async () => {
    const { tools } = makeTools();
    mockFetch([completion('Here you go:\n```json\n{"answer":"Ali.","contactIds":["id1"]}\n```')]);
    expect(await run(tools)).toMatchObject({ rounds: 1, result: { contactIds: ["id1"] } });
  });

  it("a turn with no tool calls and no answer is told to finish", async () => {
    const { tools } = makeTools();
    const { sent } = mockFetch([
      completion("I think the answer might be Ali."),
      completion(null, {
        toolCalls: [{ name: "final_answer", args: { answer: "Ali.", contactIds: [] } }],
      }),
    ]);
    const out = await run(tools);
    expect(out.rounds).toBe(2);
    expect(messagesOf(sent[1]).at(-1)).toEqual({
      role: "user",
      content: "Finish by calling final_answer.",
    });
  });

  it("an invalid final_answer call is answered with the problem", async () => {
    const { tools } = makeTools();
    const { sent } = mockFetch([
      completion(null, { toolCalls: [{ name: "final_answer", args: { answer: "x" }, id: "f" }] }),
      completion(null, {
        toolCalls: [{ name: "final_answer", args: { answer: "x", contactIds: [] } }],
      }),
    ]);
    await run(tools);
    expect(messagesOf(sent[1]).at(-1)).toMatchObject({ role: "tool", tool_call_id: "f" });
    expect(messagesOf(sent[1]).at(-1)!.content).toMatch(/^Invalid input: contactIds/);
  });

  it("forces the final round: no tools may be called, the answer is JSON", async () => {
    const { tools, seen } = makeTools();
    const search = completion(null, {
      toolCalls: [{ name: "search_contacts", args: { text: "more" } }],
    });
    const { sent } = mockFetch([
      search,
      search,
      completion('{"answer":"Best guess.","contactIds":["id1"]}'),
    ]);
    const out = await run(tools);
    expect(out).toMatchObject({ rounds: 3, result: { answer: "Best guess." } });
    expect(seen).toHaveLength(2);
    const last = sent[2].body as Record<string, never>;
    expect(last.tool_choice).toBe("none");
    expect(last.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    expect(messagesOf(sent[2]).at(-1)).toEqual({
      role: "user",
      content: "Give the final answer now as JSON only.",
    });
  });

  it("the final round still accepts a final_answer tool call", async () => {
    const { tools } = makeTools();
    mockFetch([
      completion(null, {
        toolCalls: [{ name: "final_answer", args: { answer: "A.", contactIds: [] } }],
      }),
    ]);
    expect(await run(tools, 1)).toMatchObject({ rounds: 1, result: { answer: "A." } });
  });

  it("prompt mode writes the schema into the last message instead of response_format", async () => {
    setEnv({ AI_MODEL_TEXT: "text/model:free", AI_JSON_MODE: "prompt" });
    const { tools } = makeTools();
    const { sent } = mockFetch([completion('{"answer":"A.","contactIds":[]}')]);
    await run(tools, 1);
    expect(sent[0].body).not.toHaveProperty("response_format");
    expect(messagesOf(sent[0]).at(-1)!.content).toMatch(
      /^Give the final answer now as JSON only\. Reply with one JSON object only/,
    );
  });

  it("nothing valid → AI_FAILED after exactly maxRounds requests", async () => {
    const { tools } = makeTools();
    const search = completion(null, {
      toolCalls: [{ name: "search_contacts", args: { text: "x" } }],
    });
    const { sent } = mockFetch([search, search, completion("I could not decide."), search]);
    await expect(run(tools)).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "AI search did not finish. Try rephrasing the question.",
    });
    expect(sent).toHaveLength(3);
  });
});
