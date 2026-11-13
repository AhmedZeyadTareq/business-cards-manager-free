import { describe, expect, it } from "vitest";
import { isFreeModel, parseConfig } from "@/lib/config";

const base = {
  AUTH_SECRET: "x".repeat(32),
  OPENROUTER_API_KEY: "key",
  MONGODB_URI: "mongodb://localhost:27017",
};

describe("config", () => {
  it("applies the defaults", () => {
    const config = parseConfig(base);
    expect(config.AI_MODEL_TEXT).toBe("openrouter/free");
    expect(config.AI_MODEL_VISION).toBe("openrouter/free");
    expect(config.AI_JSON_MODE).toBe("schema");
    expect(config.AI_TIMEOUT_MS).toBe(60_000);
    expect(config.AI_DEADLINE_MS).toBe(120_000);
    expect(config.AI_MAX_TOKENS).toBe(8000);
    expect(config.AI_USER_DAILY_LIMIT).toBe(15);
    expect(config.APP_TIME_ZONE).toBe("Asia/Baghdad");
    expect(config.MONGODB_DB).toBe("cards");
    expect(config.EVAL_DB).toBe("cards_eval");
    expect(config.MAX_IMAGE_MB).toBe(20);
    expect(config.AI_FALLBACK_MODELS_TEXT).toEqual([]);
    expect(config.OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });

  it("treats empty strings as missing and lists every problem in one error", () => {
    let message = "";
    try {
      parseConfig({ AUTH_SECRET: "short", OPENROUTER_API_KEY: "", MONGODB_URI: "postgres://x" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("AUTH_SECRET: must be at least 32 characters");
    expect(message).toContain("OPENROUTER_API_KEY: is required");
    expect(message).toContain("MONGODB_URI: must start with mongodb://");
  });

  it("refuses a paid model unless AI_ALLOW_PAID=true", () => {
    expect(() => parseConfig({ ...base, AI_MODEL_TEXT: "openai/gpt-4o" })).toThrow(
      /AI_MODEL_TEXT: "openai\/gpt-4o" is not a free model/,
    );
    expect(() =>
      parseConfig({ ...base, AI_FALLBACK_MODELS_VISION: "a/b:free, google/gemini-pro" }),
    ).toThrow(/AI_FALLBACK_MODELS_VISION/);
    const allowed = parseConfig({ ...base, AI_MODEL_TEXT: "openai/gpt-4o", AI_ALLOW_PAID: "true" });
    expect(allowed.AI_MODEL_TEXT).toBe("openai/gpt-4o");
  });

  it("accepts free ids and splits fallback lists", () => {
    expect(isFreeModel("openrouter/free")).toBe(true);
    expect(isFreeModel("meta/llama:free")).toBe(true);
    expect(isFreeModel("meta/llama")).toBe(false);
    const config = parseConfig({ ...base, AI_FALLBACK_MODELS_TEXT: " a/b:free , c/d:free " });
    expect(config.AI_FALLBACK_MODELS_TEXT).toEqual(["a/b:free", "c/d:free"]);
  });

  it("checks limits", () => {
    expect(() => parseConfig({ ...base, MAX_IMAGE_MB: "25" })).toThrow(/MAX_IMAGE_MB/);
    expect(() => parseConfig({ ...base, AI_TIMEOUT_MS: "90000", AI_DEADLINE_MS: "60000" })).toThrow(
      /AI_DEADLINE_MS: must not be below AI_TIMEOUT_MS/,
    );
    expect(() => parseConfig({ ...base, APP_TIME_ZONE: "Mars/Olympus" })).toThrow(/APP_TIME_ZONE/);
  });
});
