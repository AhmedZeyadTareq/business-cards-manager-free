// npm run eval:text [-- <name>] [--limit N] — accuracy of text → contacts (real API).
import { readdirSync, readFileSync } from "node:fs";
import { config } from "@/lib/config";
import type { ContactInput } from "@/modules/contacts/contact.schema";
import { extractContactsFromText } from "@/modules/extraction/structure-text";
import {
  describeCalls,
  describeSetup,
  errorText,
  pace,
  parseArgs,
  saveResult,
  trackCalls,
} from "./eval-common";
import {
  failedCase,
  formatReport,
  percent,
  scoreCase,
  summarize,
  type CaseScore,
} from "./eval-score";

const DIR = "tests/fixtures/text";
const TARGET = 0.95;

async function main() {
  const { limit, name } = parseArgs();
  const env = config();
  let names = readdirSync(DIR)
    .filter((file) => file.endsWith(".txt"))
    .map((file) => file.replace(/\.txt$/, ""))
    .sort();
  if (name) names = names.filter((fixture) => fixture.includes(name));
  if (limit) names = names.slice(0, limit);
  if (names.length === 0) throw new Error("No text fixtures match.");

  console.log(`eval:text — ${names.length} fixtures\n${describeSetup("text")}\n`);
  const { stats, stop } = trackCalls();
  const cases: CaseScore[] = [];
  for (const [index, fixture] of names.entries()) {
    const text = readFileSync(`${DIR}/${fixture}.txt`, "utf8");
    const expected = JSON.parse(
      readFileSync(`${DIR}/${fixture}.expected.json`, "utf8"),
    ) as ContactInput[];
    try {
      cases.push(scoreCase(fixture, expected, await extractContactsFromText(text.trim())));
    } catch (error) {
      cases.push(failedCase(fixture, expected, errorText(error)));
    }
    if (index < names.length - 1) await pace();
  }
  stop();

  const summary = summarize(cases);
  const met = summary.keyAccuracy >= TARGET;
  console.log(`\n${formatReport(cases)}\n\n${describeCalls(stats)}`);
  console.log(
    `\nTarget: key fields ≥ ${percent(TARGET)} → ${met ? "MET" : "MISSED"} (${percent(summary.keyAccuracy)})`,
  );
  const path = saveResult("text", {
    kind: "text",
    date: new Date().toISOString(),
    configuredModel: env.AI_MODEL_TEXT,
    fallbacks: env.AI_FALLBACK_MODELS_TEXT,
    jsonMode: env.AI_JSON_MODE,
    calls: stats,
    summary,
    targetMet: met,
    cases,
  });
  console.log(`Saved ${path}`);
  process.exit(met ? 0 : 1);
}

main().catch((error) => {
  console.error(errorText(error));
  process.exit(1);
});
