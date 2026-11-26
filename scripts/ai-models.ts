// npm run ai:models — lists the free OpenRouter models by ability and checks the
// configured ones. Uses the public model list: no key, no free requests.
import { isFreeModel, parseConfig } from "@/lib/config";

type Model = {
  id: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[] };
  supported_parameters?: string[];
  top_provider?: { max_completion_tokens?: number | null };
};

const base = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(
  /\/+$/,
  "",
);

const abilities = (model: Model) => {
  const parameters = model.supported_parameters ?? [];
  return {
    image: (model.architecture?.input_modalities ?? []).includes("image"),
    tools: parameters.includes("tools"),
    structured: parameters.includes("structured_outputs"),
    jsonFormat: parameters.includes("response_format"),
    reasoning: parameters.includes("reasoning") || parameters.includes("include_reasoning"),
  };
};

const isZeroPriced = (model: Model) =>
  Number(model.pricing?.prompt) === 0 && Number(model.pricing?.completion) === 0;

const mark = (value: boolean) => (value ? "yes" : "-");

function table(models: Model[]): void {
  const rows = models.map((model) => {
    const a = abilities(model);
    return [
      model.id,
      String(model.context_length ?? "?"),
      String(model.top_provider?.max_completion_tokens ?? "?"),
      mark(a.image),
      mark(a.tools),
      mark(a.structured),
      mark(a.reasoning),
    ];
  });
  const header = ["model", "context", "max out", "image", "tools", "structured", "reasoning"];
  const widths = header.map((title, i) =>
    Math.max(title.length, ...rows.map((row) => row[i].length)),
  );
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

async function keyStatus(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return console.log("Key: OPENROUTER_API_KEY is not set (not needed for this list).");
  try {
    const response = await fetch(`${base}/key`, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) return console.log(`Key: rejected (HTTP ${response.status}).`);
    const { data } = (await response.json()) as { data?: Record<string, unknown> };
    console.log(
      `Key: works. Free tier: ${data?.is_free_tier ?? "?"}; usage: ${data?.usage ?? "?"}; limit: ${data?.limit ?? "none"}.`,
    );
  } catch {
    console.log("Key: could not be checked (network).");
  }
}

async function main() {
  const response = await fetch(`${base}/models`);
  if (!response.ok) throw new Error(`GET ${base}/models answered HTTP ${response.status}`);
  const all = ((await response.json()) as { data: Model[] }).data;
  const byId = new Map(all.map((model) => [model.id, model]));

  const usable = all.filter((model) => isFreeModel(model.id) && model.id !== "openrouter/free");
  const sorted = (list: Model[]) =>
    [...list].sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));

  console.log(`\nFree models (${usable.length}) — what each one CLAIMS; ai:smoke proves it.\n`);
  console.log("Text + Ask AI candidates (tools):");
  table(sorted(usable.filter((model) => abilities(model).tools)));
  console.log("\nPhoto candidates (image input):");
  table(sorted(usable.filter((model) => abilities(model).image)));
  const rest = usable.filter((model) => !abilities(model).tools && !abilities(model).image);
  if (rest.length) console.log(`\nNot usable here (no tools, no images): ${rest.length} models.`);

  const hidden = all.filter((model) => isZeroPriced(model) && !isFreeModel(model.id));
  if (hidden.length) {
    console.log("\nZero-priced but without the :free suffix — needs AI_ALLOW_PAID=true:");
    for (const model of hidden) console.log(`  ${model.id}`);
  }

  console.log("\nConfigured models:");
  let config;
  try {
    config = parseConfig({
      AUTH_SECRET: "x".repeat(32),
      OPENROUTER_API_KEY: "x",
      MONGODB_URI: "mongodb://x",
      ...process.env,
    });
  } catch (error) {
    console.log((error as Error).message);
    process.exitCode = 1;
    return;
  }

  let failed = false;
  const check = (label: string, id: string, needs: "tools" | "image") => {
    if (id === "openrouter/free") {
      return console.log(
        `  PASS  ${label} = openrouter/free (OpenRouter picks a free model per request; pin a model before measuring)`,
      );
    }
    const model = byId.get(id);
    if (!model) {
      failed = true;
      return console.log(`  FAIL  ${label} = ${id}: not in the model list (removed or misspelled)`);
    }
    const a = abilities(model);
    const okAbility = needs === "tools" ? a.tools : a.image;
    if (!okAbility) failed = true;
    const notes = [
      needs === "tools" ? `tools ${mark(a.tools)}` : `image input ${mark(a.image)}`,
      `structured outputs ${mark(a.structured)}${a.structured ? "" : " (use AI_JSON_MODE=prompt)"}`,
      a.reasoning ? "reasoning model (thinking uses AI_MAX_TOKENS)" : "",
    ].filter(Boolean);
    console.log(`  ${okAbility ? "PASS" : "FAIL"}  ${label} = ${id}: ${notes.join("; ")}`);
  };
  check("AI_MODEL_TEXT", config.AI_MODEL_TEXT, "tools");
  config.AI_FALLBACK_MODELS_TEXT.forEach((id) => check("AI_FALLBACK_MODELS_TEXT", id, "tools"));
  check("AI_MODEL_VISION", config.AI_MODEL_VISION, "image");
  config.AI_FALLBACK_MODELS_VISION.forEach((id) => check("AI_FALLBACK_MODELS_VISION", id, "image"));
  console.log(`  JSON mode: ${config.AI_JSON_MODE}; data collection: ${config.AI_DATA_COLLECTION}`);

  console.log("");
  await keyStatus();
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
