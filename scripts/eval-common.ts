// Shared by the three eval scripts: arguments, pacing, call statistics, saving results.
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "@/lib/config";
import { onAiLog } from "@/modules/ai/log";

export function parseArgs(argv = process.argv.slice(2)) {
  const limitAt = argv.indexOf("--limit");
  const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) : undefined;
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const name = argv.find(
    (arg, index) => !arg.startsWith("--") && !(limitAt >= 0 && index === limitAt + 1),
  );
  return { limit: Number.isFinite(limit) ? limit : undefined, name, flags };
}

/** Counts what the AI layer did, from its log lines (never the bodies). */
export function trackCalls() {
  const stats = {
    requests: 0,
    retries: 0,
    rateLimited: 0,
    failures: 0,
    models: {} as Record<string, number>,
  };
  const stop = onAiLog((entry) => {
    stats.requests++;
    if (entry.attempt > 1) stats.retries++;
    if (entry.status === 429) stats.rateLimited++;
    if (!entry.ok) stats.failures++;
    else stats.models[entry.model] = (stats.models[entry.model] ?? 0) + 1;
  });
  return { stats, stop };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Free models allow about 20 requests a minute: leave room between cases. */
export async function pace(): Promise<void> {
  const local = /127\.0\.0\.1|localhost/.test(config().OPENROUTER_BASE_URL);
  await sleep(local ? 0 : 6500);
}

export function describeSetup(kind: "text" | "vision"): string {
  const env = config();
  const model = kind === "vision" ? env.AI_MODEL_VISION : env.AI_MODEL_TEXT;
  const fallbacks = kind === "vision" ? env.AI_FALLBACK_MODELS_VISION : env.AI_FALLBACK_MODELS_TEXT;
  return (
    `Configured model: ${model}` +
    (fallbacks.length ? ` (fallbacks: ${fallbacks.join(", ")})` : "") +
    ` · JSON mode: ${env.AI_JSON_MODE} · max_tokens: ${env.AI_MAX_TOKENS}`
  );
}

export function describeCalls(stats: ReturnType<typeof trackCalls>["stats"]): string {
  const answered = Object.entries(stats.models)
    .map(([model, count]) => `${model} ×${count}`)
    .join(", ");
  return (
    `Requests: ${stats.requests} · retries: ${stats.retries} · 429s: ${stats.rateLimited} · failed requests: ${stats.failures}\n` +
    `Answered by: ${answered || "(nothing answered)"}`
  );
}

export function saveResult(kind: string, data: unknown): string {
  mkdirSync("eval-results", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `eval-results/${kind}-${stamp}.json`;
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
