import { z } from "zod";

type JsonSchema = Record<string, unknown>;

// Keywords some providers reject. Zod re-checks all of them on the reply.
const REMOVED = ["$schema", "maxLength", "minLength", "minimum", "maximum", "format", "pattern"];

function visit(node: unknown, strict: boolean): unknown {
  if (Array.isArray(node)) return node.map((item) => visit(item, strict));
  if (typeof node !== "object" || node === null) return node;
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (REMOVED.includes(key)) continue;
    // `properties` maps field names to schemas: a field may be called "format" or "pattern".
    if (key === "properties" && typeof value === "object" && value !== null) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, visit(schema, strict)]),
      );
    } else if (key === "enum" || key === "required" || key === "default" || key === "const") {
      out[key] = value;
    } else {
      out[key] = visit(value, strict);
    }
  }
  if (out.type === "object" && typeof out.properties === "object" && out.properties !== null) {
    if (strict) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties);
    } else {
      delete out.additionalProperties;
    }
  }
  return out;
}

/**
 * A Zod schema as the JSON Schema sent to the provider.
 * - `strict: true` — ONLY for `response_format`: every object gets
 *   `additionalProperties: false` and every property `required`.
 * - `strict: false` — for tool `parameters`: optional fields stay optional. Never make
 *   the search tool's fields required, or the model fills them all and matches nothing.
 */
export function toProviderSchema(schema: z.ZodType, options: { strict: boolean }): JsonSchema {
  const json = z.toJSONSchema(schema, { unrepresentable: "any" });
  return visit(json, options.strict) as JsonSchema;
}

/**
 * Reads JSON from untrusted model text: trims, drops ``` fences, takes the first `{`
 * to the last `}`. Throws when nothing parses.
 */
export function parseJsonLoose(text: string): unknown {
  let body = text.trim();
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(body);
  if (fence) body = fence[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found");
  return JSON.parse(body.slice(start, end + 1));
}

/** Zod problems as one short line, for the corrective retry and for tool errors. */
export function describeIssues(error: z.ZodError, limit = 8): string {
  const lines = error.issues
    .slice(0, limit)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more`);
  return lines.join("; ");
}
