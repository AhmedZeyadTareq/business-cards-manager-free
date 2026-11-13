import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat, isDailyLimit, type ChatBody } from "@/modules/ai/client";
import { apiError, completion, mockFetch, setEnv, settle } from "./ai-helpers";

const body: ChatBody = {
  promptId: "test.v1",
  model: "test/model:free",
  messages: [{ role: "user", content: "hi" }],
};
const imageBody: ChatBody = {
  ...body,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "read" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
      ],
    },
  ],
};
const far = () => Date.now() + 120_000;

beforeEach(() => {
  vi.useFakeTimers();
  setEnv({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chat", () => {
  it("sends auth, model, provider options and the max_tokens cap", async () => {
    const { sent } = mockFetch([completion("hello", { model: "other/model:free" })]);
    const result = await settle(chat({ ...body, max_tokens: 500 }, far()));
    expect(result).toEqual({
      message: { content: "hello", tool_calls: [] },
      finishReason: "stop",
      model: "other/model:free",
      usage: { promptTokens: 10, completionTokens: 5 },
    });
    expect(sent[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[0].headers.Authorization).toBe("Bearer test-key");
    expect(sent[0].body).toMatchObject({
      model: "test/model:free",
      max_tokens: 500,
      provider: { data_collection: "allow" },
    });
    expect(sent[0].body).not.toHaveProperty("models");
    expect(sent[0].body).not.toHaveProperty("promptId");
  });

  it("caps max_tokens at AI_MAX_TOKENS and defaults to it", async () => {
    setEnv({ AI_MAX_TOKENS: "3000", AI_DATA_COLLECTION: "deny" });
    const { sent } = mockFetch([completion("a"), completion("b")]);
    await settle(chat({ ...body, max_tokens: 99_999 }, far()));
    await settle(chat(body, far()));
    expect(sent[0].body.max_tokens).toBe(3000);
    expect(sent[1].body.max_tokens).toBe(3000);
    expect(sent[0].body.provider).toEqual({ data_collection: "deny" });
  });

  it("requires parameter support only when tools or response_format are sent", async () => {
    const { sent } = mockFetch([completion("a")]);
    await settle(chat({ ...body, response_format: { type: "json_schema" } }, far()));
    expect(sent[0].body.provider).toEqual({ require_parameters: true, data_collection: "allow" });
  });

  it("sends text fallbacks on text requests and vision fallbacks on image requests", async () => {
    setEnv({
      AI_FALLBACK_MODELS_TEXT: "text/one:free,text/two:free",
      AI_FALLBACK_MODELS_VISION: "vision/one:free",
    });
    const { sent } = mockFetch([completion("a"), completion("b")]);
    await settle(chat(body, far()));
    await settle(chat(imageBody, far()));
    expect(sent[0].body.models).toEqual(["test/model:free", "text/one:free", "text/two:free"]);
    expect(sent[1].body.models).toEqual(["test/model:free", "vision/one:free"]);
    expect(sent[0].body.model).toBe("test/model:free");
  });

  it("retries a per-minute 429, then succeeds", async () => {
    const { sent } = mockFetch([
      apiError(429, "Rate limit exceeded: free-models-per-min"),
      apiError(429, "Rate limit exceeded: free-models-per-min", { "retry-after": "3" }),
      completion("ok"),
    ]);
    const result = await settle(chat(body, far()));
    expect(result.message.content).toBe("ok");
    expect(sent).toHaveLength(3);
  });

  it("gives up after 2 retries with the busy message", async () => {
    const { sent } = mockFetch(Array(3).fill(apiError(429, "Rate limit exceeded: limit_rpm")));
    await expect(settle(chat(body, far()))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "AI service is busy. Try again in a minute.",
    });
    expect(sent).toHaveLength(3);
  });

  it("never retries the daily-cap 429", async () => {
    const { sent } = mockFetch([
      apiError(
        429,
        "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
      ),
    ]);
    await expect(settle(chat(body, far()))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Today's free AI allowance is used up. Quick search and manual add still work.",
    });
    expect(sent).toHaveLength(1);
  });

  it("recognises the daily limit from the error text", () => {
    expect(isDailyLimit("Rate limit exceeded: free-models-per-day")).toBe(true);
    expect(isDailyLimit("You have reached the limit of 50 requests per day")).toBe(true);
    expect(isDailyLimit("Rate limit exceeded: free-models-per-min")).toBe(false);
    expect(isDailyLimit("Provider returned error: rate-limited upstream")).toBe(false);
  });

  it("retries 5xx and network errors", async () => {
    const { sent } = mockFetch([
      apiError(503, "down"),
      new TypeError("fetch failed"),
      completion("ok"),
    ]);
    expect((await settle(chat(body, far()))).message.content).toBe("ok");
    expect(sent).toHaveLength(3);
  });

  it("maps a network failure and a timeout to safe messages", async () => {
    mockFetch(Array(3).fill(new TypeError("fetch failed: ECONNREFUSED 10.0.0.1")));
    await expect(settle(chat(body, far()))).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "Cannot reach the AI service.",
    });
    mockFetch(Array(3).fill(new DOMException("The operation timed out", "TimeoutError")));
    await expect(settle(chat(body, far()))).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "AI service timed out. Try again.",
    });
  });

  it.each([
    [400, "AI request was rejected."],
    [401, "AI service rejected the API key."],
    [402, "The AI account needs attention. Tell an administrator."],
    [403, "The AI declined to process this input."],
    [404, "The AI model is not available. Tell an administrator."],
  ])("does not retry %i and never leaks the raw error", async (status, message) => {
    const raw = "SECRET provider detail: No endpoints found matching your data policy";
    const { sent } = mockFetch([apiError(status, raw)]);
    const error = await settle(chat(body, far())).catch((cause) => cause);
    expect(error).toMatchObject({ code: "AI_FAILED", message });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain("SECRET");
    expect(sent).toHaveLength(1);
  });

  it("treats HTTP 200 with an error body as a failure", async () => {
    mockFetch([{ status: 200, body: { error: { code: 404, message: "No endpoints found" } } }]);
    await expect(settle(chat(body, far()))).rejects.toMatchObject({
      message: "The AI model is not available. Tell an administrator.",
    });
    mockFetch([
      {
        status: 200,
        body: {
          choices: [{ error: { code: 502, message: "upstream" }, message: { content: "" } }],
        },
      },
      completion("recovered"),
    ]);
    expect((await settle(chat(body, far()))).message.content).toBe("recovered");
    mockFetch(Array(3).fill({ status: 200, text: "<html>not json</html>" }));
    await expect(settle(chat(body, far()))).rejects.toMatchObject({
      message: "AI service failed. Try again.",
    });
  });

  it("reads tool calls and array content", async () => {
    mockFetch([completion(null, { toolCalls: [{ name: "search", args: { q: "x" } }] })]);
    const result = await settle(chat(body, far()));
    expect(result.message).toEqual({
      content: "",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } },
      ],
    });
    expect(result.finishReason).toBe("tool_calls");
  });

  it("starts nothing after the deadline", async () => {
    const { sent } = mockFetch([completion("late")]);
    await expect(settle(chat(body, Date.now() - 1))).rejects.toMatchObject({
      code: "AI_FAILED",
      message: "AI service timed out. Try again.",
    });
    expect(sent).toHaveLength(0);
  });

  it("the deadline shortens the request timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    mockFetch([completion("a"), completion("b")]);
    await settle(chat(body, Date.now() + 5_000));
    expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(5_000);
    expect(timeout.mock.calls[0][0]).toBeGreaterThan(4_000);
    await settle(chat(body, far()));
    expect(timeout.mock.calls[1][0]).toBe(60_000); // AI_TIMEOUT_MS
    timeout.mockRestore();
  });

  it("the deadline stops further retries", async () => {
    // The first retry would wait 2 s, but only 1.5 s are left.
    const { sent } = mockFetch([apiError(503, "down"), completion("never")]);
    await expect(settle(chat(body, Date.now() + 1_500))).rejects.toMatchObject({
      code: "AI_FAILED",
    });
    expect(sent).toHaveLength(1);

    // Retry-After longer than what is left: no retry either.
    const second = mockFetch([
      apiError(429, "per-min", { "retry-after": "30" }),
      completion("never"),
    ]);
    await expect(settle(chat(body, Date.now() + 10_000))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(second.sent).toHaveLength(1);
  });
});
