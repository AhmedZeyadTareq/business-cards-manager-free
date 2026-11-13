import { config } from "@/lib/config";
import { AppError } from "@/modules/shared/errors";
import { logAi } from "./log";

// THE ONLY fetch to OpenRouter. Adds auth, fallbacks, provider options, the max_tokens
// cap, timeout and retries, all inside the caller's deadline; maps errors to AppError.
// Request and response formats: docs/tools.md §7.

export type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatBody = {
  /** For the log line only (the prompt id). Never sent. */
  promptId: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none";
  response_format?: Record<string, unknown>;
  plugins?: { id: string }[];
  /** A caller may ask for less than AI_MAX_TOKENS, never more. */
  max_tokens?: number;
};

export type ChatResult = {
  message: { content: string; tool_calls: ToolCall[] };
  finishReason: string;
  model: string;
  usage: { promptTokens?: number; completionTokens?: number };
};

export const AI_MESSAGES = {
  timeout: "AI service timed out. Try again.",
  busy: "AI service is busy. Try again in a minute.",
  daily: "Today's free AI allowance is used up. Quick search and manual add still work.",
  unavailable: "The AI model is not available. Tell an administrator.",
  rejected: "AI request was rejected.",
  key: "AI service rejected the API key.",
  account: "The AI account needs attention. Tell an administrator.",
  declined: "The AI declined to process this input.",
  failed: "AI service failed. Try again.",
  unreachable: "Cannot reach the AI service.",
} as const;

/** One deadline per user action, shared by every request, retry and round. */
export function newDeadline(): number {
  return Date.now() + config().AI_DEADLINE_MS;
}

type Failure = {
  error: AppError;
  retry: boolean;
  /** Seconds, from Retry-After. */
  retryAfter?: number;
  status?: number;
  /** Raw provider text: for the server log only, never for the AppError. */
  raw: string;
};

/** The daily-cap 429 names a per-day free limit; the per-minute one does not. */
export function isDailyLimit(raw: string): boolean {
  return /per[-_ ]?day|free-models-per-day|daily|requests per day/i.test(raw);
}

function failureFor(status: number, raw: string, retryAfter?: number): Failure {
  const fail = (code: "AI_FAILED" | "TOO_MANY_REQUESTS", message: string, retry: boolean) => ({
    error: new AppError(code, message),
    retry,
    retryAfter,
    status,
    raw,
  });
  if (status === 429) {
    return isDailyLimit(raw)
      ? fail("TOO_MANY_REQUESTS", AI_MESSAGES.daily, false)
      : fail("TOO_MANY_REQUESTS", AI_MESSAGES.busy, true);
  }
  if (status === 400) return fail("AI_FAILED", AI_MESSAGES.rejected, false);
  if (status === 401) return fail("AI_FAILED", AI_MESSAGES.key, false);
  if (status === 402) return fail("AI_FAILED", AI_MESSAGES.account, false);
  if (status === 403) return fail("AI_FAILED", AI_MESSAGES.declined, false);
  if (status === 404) return fail("AI_FAILED", AI_MESSAGES.unavailable, false);
  if (status === 408) return fail("AI_FAILED", AI_MESSAGES.timeout, true);
  if (status >= 500) return fail("AI_FAILED", AI_MESSAGES.failed, true);
  return fail("AI_FAILED", AI_MESSAGES.rejected, false);
}

function hasImage(messages: ChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === "image_url"),
  );
}

function buildRequest(body: ChatBody): Record<string, unknown> {
  const env = config();
  const fallbacks = hasImage(body.messages)
    ? env.AI_FALLBACK_MODELS_VISION
    : env.AI_FALLBACK_MODELS_TEXT;
  const needsParameters = Boolean(body.tools?.length || body.response_format);
  const request: Record<string, unknown> = {
    model: body.model,
    max_tokens: Math.min(body.max_tokens ?? env.AI_MAX_TOKENS, env.AI_MAX_TOKENS),
    messages: body.messages,
    provider: {
      // Only providers that support every parameter sent (tools, response_format).
      ...(needsParameters ? { require_parameters: true } : {}),
      data_collection: env.AI_DATA_COLLECTION,
    },
  };
  if (fallbacks.length > 0) {
    request.models = [body.model, ...fallbacks.filter((id) => id !== body.model)];
  }
  if (body.tools?.length) {
    request.tools = body.tools;
    request.tool_choice = body.tool_choice ?? "auto";
  }
  if (body.response_format) request.response_format = body.response_format;
  if (body.plugins?.length) request.plugins = body.plugins;
  return request;
}

type Wire = {
  error?: { code?: number | string; message?: string; metadata?: unknown };
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: {
    finish_reason?: string | null;
    error?: { code?: number | string; message?: string };
    message?: { content?: unknown; tool_calls?: unknown };
  }[];
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "object" && part !== null && typeof part.text === "string" ? part.text : "",
      )
      .join("");
  }
  return "";
}

function toolCallsOf(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((call, index) => {
    const fn = call?.function;
    if (!fn || typeof fn.name !== "string") return [];
    return [
      {
        id: typeof call.id === "string" && call.id ? call.id : `call_${index}`,
        type: "function" as const,
        function: {
          name: fn.name,
          arguments:
            typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        },
      },
    ];
  });
}

async function once(
  request: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ result: ChatResult } | { failure: Failure }> {
  const env = config();
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "Business Cards Manager",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await response.text();
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return {
        failure: {
          error: new AppError("AI_FAILED", AI_MESSAGES.timeout),
          retry: true,
          raw: "timeout",
        },
      };
    }
    return {
      failure: {
        error: new AppError("AI_FAILED", AI_MESSAGES.unreachable),
        retry: true,
        raw: cause instanceof Error ? `${cause.name}: ${cause.message}` : "network error",
      },
    };
  }

  const retryHeader = Number(response.headers.get("retry-after"));
  const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined;

  let wire: Wire | undefined;
  try {
    wire = JSON.parse(text) as Wire;
  } catch {
    wire = undefined;
  }

  if (!response.ok) {
    return { failure: failureFor(response.status, text.slice(0, 2000), retryAfter) };
  }
  // A body containing `error` is a failure even with HTTP 200.
  const bodyError = wire?.error ?? wire?.choices?.[0]?.error;
  if (bodyError) {
    const code = Number(bodyError.code);
    const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : 502;
    return { failure: failureFor(status, JSON.stringify(bodyError).slice(0, 2000), retryAfter) };
  }
  const choice = wire?.choices?.[0];
  if (!wire || !choice?.message) {
    return { failure: failureFor(502, "no choices in the response") };
  }
  return {
    result: {
      message: {
        content: textOf(choice.message.content),
        tool_calls: toolCallsOf(choice.message.tool_calls),
      },
      finishReason: choice.finish_reason ?? "stop",
      model: wire.model ?? String(request.model),
      usage: {
        promptTokens: wire.usage?.prompt_tokens,
        completionTokens: wire.usage?.completion_tokens,
      },
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRY_WAITS_MS = [2000, 5000];

/**
 * One chat completion. `deadline` (ms since epoch) is shared by everything one user
 * action does: no request gets more time than is left, and nothing starts after it.
 */
export async function chat(body: ChatBody, deadline: number): Promise<ChatResult> {
  const env = config();
  const request = buildRequest(body);

  for (let attempt = 1; ; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) {
      logAi({
        prompt: body.promptId,
        model: body.model,
        ms: 0,
        attempt,
        ok: false,
        error: "deadline passed",
      });
      throw new AppError("AI_FAILED", AI_MESSAGES.timeout);
    }
    const started = Date.now();
    const outcome = await once(request, Math.min(env.AI_TIMEOUT_MS, left));
    const ms = Date.now() - started;

    if ("result" in outcome) {
      const { result } = outcome;
      logAi({
        prompt: body.promptId,
        model: result.model,
        ms,
        attempt,
        ok: true,
        finish: result.finishReason,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      });
      return result;
    }

    const { failure } = outcome;
    // The raw provider error stays in the server log; staff only see the safe message.
    logAi({
      prompt: body.promptId,
      model: body.model,
      ms,
      attempt,
      ok: false,
      status: failure.status,
      error: failure.raw,
    });

    const waitMs =
      failure.retryAfter !== undefined ? failure.retryAfter * 1000 : RETRY_WAITS_MS[attempt - 1];
    if (!failure.retry || attempt > RETRY_WAITS_MS.length) throw failure.error;
    // No retry that would start after the deadline.
    if (Date.now() + waitMs >= deadline) {
      throw Date.now() >= deadline - 50
        ? new AppError("AI_FAILED", AI_MESSAGES.timeout)
        : failure.error;
    }
    await sleep(waitMs);
  }
}
