// One JSON line per AI call. Never prompt or response bodies: contact data must not
// reach the logs.

export type AiLogEntry = {
  prompt: string;
  /** The model that really answered (or the requested one when the call failed). */
  model: string;
  ms: number;
  attempt: number;
  ok: boolean;
  finish?: string;
  promptTokens?: number;
  completionTokens?: number;
  status?: number;
  error?: string;
};

type Listener = (entry: AiLogEntry) => void;
const listeners = new Set<Listener>();

/** The eval scripts count retries, 429s and answering models through this. */
export function onAiLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function logAi(entry: AiLogEntry): void {
  for (const listener of listeners) listener(entry);
  if (process.env.VITEST || process.env.AI_LOG === "off") return;
  console.log(`[ai] ${JSON.stringify({ time: new Date().toISOString(), ...entry })}`);
}
