import { vi } from "vitest";
import { resetConfig } from "@/lib/config";

type Reply =
  { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error;

export type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** Replaces global fetch with a queue of replies and records what was sent. */
export function mockFetch(replies: Reply[]): { sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...replies];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(String(init.body)),
      });
      const reply = queue.shift();
      if (!reply) throw new Error("mockFetch: no reply left");
      if (reply instanceof Error) throw reply;
      const text = reply.text ?? JSON.stringify(reply.body ?? {});
      return new Response(text, { status: reply.status ?? 200, headers: reply.headers });
    }),
  );
  return { sent };
}

export function completion(
  content: string | null,
  extra: {
    finish?: string;
    model?: string;
    toolCalls?: { name: string; args: unknown; id?: string }[];
  } = {},
) {
  return {
    body: {
      model: extra.model ?? "test/model:free",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [
        {
          finish_reason: extra.finish ?? (extra.toolCalls ? "tool_calls" : "stop"),
          message: {
            role: "assistant",
            content,
            ...(extra.toolCalls
              ? {
                  tool_calls: extra.toolCalls.map((call, index) => ({
                    id: call.id ?? `call_${index + 1}`,
                    type: "function",
                    function: {
                      name: call.name,
                      arguments:
                        typeof call.args === "string" ? call.args : JSON.stringify(call.args),
                    },
                  })),
                }
              : {}),
          },
        },
      ],
    },
  };
}

export function apiError(status: number, message: string, headers?: Record<string, string>) {
  return { status, body: { error: { code: status, message } }, headers };
}

/** Sets AI env keys for one test (the config is re-read). */
export function setEnv(values: Record<string, string>): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("AI_")) delete process.env[key];
  }
  Object.assign(process.env, values);
  resetConfig();
}

/** Runs a promise to its end while fake timers jump over every retry wait. */
export async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const guarded = promise.finally(() => {
    done = true;
  });
  guarded.catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(1000);
  return guarded;
}
