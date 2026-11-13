import { z } from "zod";

// Every env key of docs/tools.md §4, validated once. Empty strings count as missing.

export function isFreeModel(id: string): boolean {
  return id === "openrouter/free" || id.endsWith(":free");
}

const int = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

const modelList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );

const timeZone = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, "must be an IANA time zone such as Asia/Baghdad");

const EnvSchema = z
  .object({
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    OPENROUTER_API_KEY: z.string().min(1),
    AI_MODEL_TEXT: z.string().default("openrouter/free"),
    AI_MODEL_VISION: z.string().default("openrouter/free"),
    AI_FALLBACK_MODELS_TEXT: modelList,
    AI_FALLBACK_MODELS_VISION: modelList,
    AI_JSON_MODE: z.enum(["schema", "prompt"]).default("schema"),
    AI_DATA_COLLECTION: z.enum(["allow", "deny"]).default("allow"),
    AI_ALLOW_PAID: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    AI_TIMEOUT_MS: int(60_000, 1_000, 280_000),
    // The AI routes export maxDuration = 300 s (a build-time constant), so the deadline
    // must stay 20 s below it.
    AI_DEADLINE_MS: int(120_000, 1_000, 280_000),
    AI_MAX_TOKENS: int(8_000, 256, 200_000),
    AI_USER_DAILY_LIMIT: int(15, 0, 100_000),
    APP_TIME_ZONE: timeZone.default("Asia/Baghdad"),
    OPENROUTER_BASE_URL: z
      .string()
      .regex(/^https?:\/\//, "must start with http:// or https://")
      .default("https://openrouter.ai/api/v1")
      .transform((url) => url.replace(/\/+$/, "")),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
    MONGODB_DB: z.string().default("cards"),
    EVAL_DB: z.string().default("cards_eval"),
    MAX_TEXT_CHARS: int(20_000, 100, 200_000),
    MAX_IMAGE_MB: int(20, 1, 20),
  })
  .superRefine((env, ctx) => {
    if (env.AI_DEADLINE_MS < env.AI_TIMEOUT_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["AI_DEADLINE_MS"],
        message: "must not be below AI_TIMEOUT_MS",
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const present: Record<string, string> = {};
  for (const key of Object.keys(EnvSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") present[key] = value.trim();
  }
  const result = EnvSchema.safeParse(present);
  const lines = result.success
    ? []
    : result.error.issues.map((issue) => {
        const key = issue.path.join(".") || "env";
        return `  - ${key}: ${key in present ? issue.message : "is required"}`;
      });

  // Free only by default. Checked on the raw values, so it is reported together with
  // any other problem.
  if (present.AI_ALLOW_PAID !== "true") {
    for (const key of MODEL_KEYS) {
      const ids = (present[key] ?? "").split(",").map((id) => id.trim());
      for (const id of ids.filter(Boolean)) {
        if (!isFreeModel(id)) {
          lines.push(
            `  - ${key}: "${id}" is not a free model (use openrouter/free or an id ending in :free, or set AI_ALLOW_PAID=true)`,
          );
        }
      }
    }
  }

  if (result.success && lines.length === 0) return result.data;
  throw new ConfigError(
    `Invalid environment (see .env.example and docs/tools.md §4):\n${[...new Set(lines)].join("\n")}`,
  );
}

const MODEL_KEYS = [
  "AI_MODEL_TEXT",
  "AI_MODEL_VISION",
  "AI_FALLBACK_MODELS_TEXT",
  "AI_FALLBACK_MODELS_VISION",
] as const;

let cached: Config | undefined;

/** The validated env. Throws one readable error listing every problem. */
export function config(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

/** For tests only. */
export function resetConfig(): void {
  cached = undefined;
}

/** Server startup: print every env problem and stop. */
export function checkConfigOrExit(): void {
  try {
    config();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
