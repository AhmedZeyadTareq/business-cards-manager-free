import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callJson } from "@/modules/ai/call-json";
import { parseJsonLoose, toProviderSchema } from "@/modules/ai/json";
import { AiContact, ContactInput, SearchParams } from "@/modules/contacts/contact.schema";
import { apiError, completion, mockFetch, setEnv, settle } from "./ai-helpers";

describe("toProviderSchema", () => {
  const schema = z.object({
    name: z.string().max(10).describe("The name"),
    age: z.number().int().min(0).max(120).optional(),
    email: z.email().optional(),
    code: z.string().regex(/^\d+$/).optional(),
    nested: z.object({ format: z.string(), tags: z.array(z.object({ pattern: z.string() })) }),
  });

  it("removes keywords providers reject, but not fields with the same names", () => {
    const text = JSON.stringify(toProviderSchema(schema, { strict: true }));
    for (const keyword of ['"$schema"', '"maxLength"', '"minimum"', '"maximum"']) {
      expect(text).not.toContain(keyword);
    }
    const json = toProviderSchema(schema, { strict: true }) as {
      properties: Record<string, { properties?: Record<string, unknown>; description?: string }>;
    };
    expect(json.properties.email).toEqual({ type: "string" });
    expect(json.properties.code).toEqual({ type: "string" });
    expect(json.properties.name.description).toBe("The name");
    expect(json.properties.nested.properties).toHaveProperty("format");
  });

  it("strict: every object closed and every property required", () => {
    const json = toProviderSchema(schema, { strict: true }) as Record<string, never>;
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(["name", "age", "email", "code", "nested"]);
    const nested = (json.properties as Record<string, Record<string, never>>).nested;
    expect(nested.additionalProperties).toBe(false);
    expect(nested.required).toEqual(["format", "tags"]);
    const item = (nested.properties as Record<string, { items: Record<string, unknown> }>).tags
      .items;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["pattern"]);
  });

  it("not strict: optional fields stay optional and nothing is closed", () => {
    const json = toProviderSchema(schema, { strict: false });
    expect(json.required).toEqual(["name", "nested"]);
    expect(json).not.toHaveProperty("additionalProperties");
    const search = toProviderSchema(SearchParams, { strict: false });
    expect(search.required ?? []).toEqual([]);
    expect(search).not.toHaveProperty("additionalProperties");
    expect(Object.keys(search.properties as object)).toEqual([
      "text",
      "FullName",
      "Position",
      "Company",
      "City",
      "Sector",
      "dateFrom",
      "dateTo",
      "limit",
    ]);
  });

  it("the tolerant AI contact schema is sent as 8 required strings with the sector enum", () => {
    const json = toProviderSchema(z.object({ contacts: z.array(AiContact) }), { strict: true });
    const item = (json.properties as { contacts: { items: Record<string, never> } }).contacts.items;
    expect(item.required).toHaveLength(8);
    const properties = item.properties as Record<string, { type: string; enum?: string[] }>;
    expect(properties.FullName).toEqual({ type: "string" });
    expect(properties.Sector.enum).toHaveLength(6);
  });
});

describe("parseJsonLoose", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ['  \n{"a":1}\n ', { a: 1 }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['```\n{"a":1}\n```', { a: 1 }],
    ['Here is the result:\n{"a":{"b":[1,2]}}\nHope it helps!', { a: { b: [1, 2] } }],
    ['Sure!\n```json\n{"a":"}"}\n```\nDone.', { a: "}" }],
  ])("reads %j", (text, expected) => {
    expect(parseJsonLoose(text)).toEqual(expected);
  });

  it.each(["", "no json here", "{broken", '{"a":1', "[1,2,3]", "}{"])("throws on %j", (text) => {
    expect(() => parseJsonLoose(text)).toThrow();
  });
});

describe("callJson", () => {
  const prompt = { id: "test.v1", text: "Extract." };
  const schema = z.object({ contacts: z.array(ContactInput) });
  const contact = {
    FullName: "Mustafa Kareem",
    Position: "",
    Mobile: "",
    Company: "Korek",
    City: "",
    Email: "",
    Sector: "Businesses & Financial Institutions",
    Notes: "",
  };
  const valid = JSON.stringify({ contacts: [contact] });

  beforeEach(() => {
    vi.useFakeTimers();
    setEnv({ AI_MODEL_TEXT: "text/model:free", AI_MODEL_VISION: "vision/model:free" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns validated output and sends the strict schema with response healing", async () => {
    const { sent } = mockFetch([completion(valid)]);
    const result = await settle(callJson({ prompt, input: "<text>x</text>", schema }));
    expect(result.contacts[0].FullName).toBe("Mustafa Kareem");
    const body = sent[0].body as Record<string, never>;
    expect(body.model).toBe("text/model:free");
    expect(body.messages).toEqual([
      { role: "system", content: "Extract." },
      { role: "user", content: "<text>x</text>" },
    ]);
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "result", strict: true, schema: { additionalProperties: false } },
    });
    expect(body.plugins).toEqual([{ id: "response-healing" }]);
    expect(body.provider).toMatchObject({ require_parameters: true });
  });

  it("accepts fenced JSON", async () => {
    mockFetch([completion("```json\n" + valid + "\n```")]);
    expect((await settle(callJson({ prompt, input: "x", schema }))).contacts).toHaveLength(1);
  });

  it("invalid → one corrective retry → valid", async () => {
    const { sent } = mockFetch([completion('{"contacts":[{"FullName":"A"}]}'), completion(valid)]);
    const result = await settle(callJson({ prompt, input: "x", schema }));
    expect(result.contacts).toHaveLength(1);
    const messages = sent[1].body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ role: "assistant", content: '{"contacts":[{"FullName":"A"}]}' });
    expect(messages[3].content).toMatch(
      /^Your previous output failed validation: .*contacts\.0\.Position/,
    );
    expect(messages[3].content).toMatch(/Return the complete corrected JSON\.$/);
  });

  it("invalid twice → AI_FAILED, after exactly 2 requests", async () => {
    const { sent } = mockFetch([completion("not json at all"), completion("still not json")]);
    await expect(settle(callJson({ prompt, input: "x", schema }))).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "The AI returned data in an unexpected format. Please try again.",
    });
    expect(sent).toHaveLength(2);
  });

  it("does not retry length or content_filter", async () => {
    let mock = mockFetch([completion('{"contacts":[{"FullName":"A', { finish: "length" })]);
    await expect(settle(callJson({ prompt, input: "x", schema }))).rejects.toMatchObject({
      message: "Input is too large for one request. Try fewer items at a time.",
    });
    expect(mock.sent).toHaveLength(1);

    mock = mockFetch([completion("", { finish: "content_filter" })]);
    await expect(settle(callJson({ prompt, input: "x", schema }))).rejects.toMatchObject({
      message: "The AI declined to process this input.",
    });
    expect(mock.sent).toHaveLength(1);
  });

  it("length with empty content: the model ran out of room while thinking", async () => {
    const { sent } = mockFetch([completion(null, { finish: "length" })]);
    await expect(settle(callJson({ prompt, input: "x", schema }))).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "The AI ran out of room before answering. Tell an administrator.",
    });
    expect(sent).toHaveLength(1);
  });

  it("sends an image as a data URL to the vision model", async () => {
    const { sent } = mockFetch([completion(valid)]);
    await settle(
      callJson({
        prompt,
        input: "Read it.",
        schema,
        image: { mediaType: "image/jpeg", data: "QUJD" },
      }),
    );
    expect(sent[0].body.model).toBe("vision/model:free");
    expect((sent[0].body.messages as { content: unknown }[])[1].content).toEqual([
      { type: "text", text: "Read it." },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
    ]);
  });

  it("prompt mode: no response_format, the schema goes into the prompt", async () => {
    setEnv({ AI_JSON_MODE: "prompt" });
    const { sent } = mockFetch([completion(valid)]);
    await settle(callJson({ prompt, input: "x", schema }));
    const body = sent[0].body;
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("plugins");
    expect(body.provider).toEqual({ data_collection: "allow" });
    const system = (body.messages as { content: string }[])[0].content;
    expect(system).toMatch(
      /^Extract\.\n\nReply with one JSON object only, no other text and no code fences\. It must match this JSON Schema:\n\{/,
    );
    expect(system).toContain('"FullName"');
  });

  it("caps maxTokens at AI_MAX_TOKENS", async () => {
    setEnv({ AI_MAX_TOKENS: "4000" });
    const { sent } = mockFetch([completion(valid), completion(valid)]);
    await settle(callJson({ prompt, input: "x", schema, maxTokens: 50_000 }));
    await settle(callJson({ prompt, input: "x", schema, maxTokens: 1_000 }));
    expect(sent[0].body.max_tokens).toBe(4000);
    expect(sent[1].body.max_tokens).toBe(1000);
  });

  it("the retry shares the action's deadline", async () => {
    setEnv({ AI_TIMEOUT_MS: "1000", AI_DEADLINE_MS: "1000" });
    const { sent } = mockFetch([apiError(503, "down"), completion(valid)]);
    await expect(settle(callJson({ prompt, input: "x", schema }))).rejects.toMatchObject({
      code: "AI_FAILED",
    });
    expect(sent).toHaveLength(1);
  });

  it("reads a weak model's contact tolerantly", () => {
    const parsed = AiContact.parse({
      FullName: "A",
      Position: null,
      Mobile: 7701234567,
      Company: "B",
      Email: "",
      Sector: "bank",
    });
    expect(parsed).toMatchObject({
      Position: "",
      Mobile: "7701234567",
      City: "",
      Notes: "",
      Sector: "Businesses & Financial Institutions",
    });
  });
});
