// npm run eval:search [-- --limit N] [--quick-only]
// Ask AI (20 questions, real API) + quick search (12 queries, no AI). Runs on its OWN
// database EVAL_DB and DELETES EVERY CONTACT THERE first. Never touches MONGODB_DB.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { config } from "@/lib/config";
import { ensureHighManagement } from "@/modules/accounts/departments.repo";
import { scriptWriter, type Scope } from "@/modules/accounts/scope";
import { ContactInputLoose } from "@/modules/contacts/contact.schema";
import { deleteAllContacts, insertContacts, quickSearch } from "@/modules/contacts/contacts.repo";
import { currentDatabaseName, switchDatabase, withDb } from "@/modules/db/mongo";
import { setupDatabase } from "@/modules/db/setup";
import { ask } from "@/modules/search/ask";
import {
  describeCalls,
  describeSetup,
  errorText,
  pace,
  parseArgs,
  saveResult,
  trackCalls,
} from "./eval-common";
import { percent } from "./eval-score";

const Questions = z.object({
  dataset: z.string(),
  ask: z.array(z.object({ question: z.string(), expected: z.string() })),
  quick: z.array(z.object({ query: z.string(), expected: z.string() })),
});

const QUICK_MS = 300;
const ASK_TARGET = 0.9;
const scope: Scope = { kind: "all" };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
  const { limit, flags } = parseArgs();
  const env = config();
  if (env.EVAL_DB === env.MONGODB_DB)
    throw new Error("EVAL_DB must not be the same database as MONGODB_DB.");
  switchDatabase(env.EVAL_DB);

  const questions = Questions.parse(
    JSON.parse(readFileSync("tests/fixtures/search/questions.json", "utf8")),
  );
  const sample = z
    .array(ContactInputLoose)
    .parse(JSON.parse(readFileSync(questions.dataset, "utf8")));

  console.log(`eval:search on database "${currentDatabaseName()}" (emptied first)`);
  await setupDatabase(console.log);
  await deleteAllContacts();
  const department = await ensureHighManagement();
  await insertContacts(scriptWriter(department._id, "eval-search"), sample, "import");

  // Atlas Search indexes new documents a moment after the write.
  const probe = sample
    .find((contact) => /^[A-Za-z]{3,}/.test(contact.FullName))!
    .FullName.split(" ")[0];
  for (let waited = 0; (await quickSearch(scope, probe)).total === 0; waited += 500) {
    if (waited > 120_000)
      throw new Error("Atlas Search did not index the sample contacts in 2 minutes.");
    await sleep(500);
  }
  await sleep(1500);

  // ----- Quick search: expected name in the top 3, median of 5 runs under 300 ms -----
  console.log(`\nQuick search (${questions.quick.length} queries):`);
  const quick = [];
  for (const { query, expected } of questions.quick) {
    await quickSearch(scope, query); // warm-up
    const times: number[] = [];
    let top: string[] = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      const found = await quickSearch(scope, query);
      times.push(performance.now() - started);
      top = found.items.slice(0, 3).map((item) => item.FullName);
    }
    const ms = median(times);
    const found = top.includes(expected);
    quick.push({
      query,
      expected,
      top,
      ms: Math.round(ms * 10) / 10,
      found,
      pass: found && ms < QUICK_MS,
    });
    console.log(
      `  ${found && ms < QUICK_MS ? "PASS" : "FAIL"}  ${ms.toFixed(1).padStart(6)} ms  "${query}" → ${expected}${found ? "" : `   (top 3: ${top.join(" | ") || "nothing"})`}`,
    );
  }
  const quickPassed = quick.filter((item) => item.pass).length;
  console.log(`Quick search: ${quickPassed}/${quick.length} in the top 3 under ${QUICK_MS} ms`);

  // ----- Ask AI: expected name in the top 3 within 3 rounds -----
  const asked = [];
  const { stats, stop } = trackCalls();
  if (!flags.has("--quick-only")) {
    const list = limit ? questions.ask.slice(0, limit) : questions.ask;
    console.log(`\nAsk AI (${list.length} questions)\n${describeSetup("text")}\n`);
    for (const [index, { question, expected }] of list.entries()) {
      try {
        const result = await ask(scope, question);
        const top = result.contacts.slice(0, 3).map((contact) => contact.FullName);
        const pass = top.includes(expected) && result.rounds <= 3;
        asked.push({ question, expected, top, rounds: result.rounds, answer: result.answer, pass });
        console.log(
          `  ${pass ? "PASS" : "FAIL"}  rounds ${result.rounds}  "${question}" → ${expected}${pass ? "" : `   (top 3: ${top.join(" | ") || "nothing"})`}`,
        );
      } catch (error) {
        asked.push({
          question,
          expected,
          top: [],
          rounds: 0,
          error: errorText(error),
          pass: false,
        });
        console.log(`  ERROR "${question}" — ${errorText(error)}`);
      }
      if (index < list.length - 1) await pace();
    }
  }
  stop();

  const askPassed = asked.filter((item) => item.pass).length;
  const quickMet = quickPassed === quick.length;
  const askMet = asked.length > 0 && askPassed / asked.length >= ASK_TARGET;
  if (asked.length) {
    console.log(`\n${describeCalls(stats)}`);
    console.log(`Failed on an API error: ${asked.filter((item) => "error" in item).length}`);
    console.log(
      `\nTarget: Ask ≥ ${percent(ASK_TARGET)} in the top 3 → ${askMet ? "MET" : "MISSED"} (${askPassed}/${asked.length})`,
    );
  }
  console.log(
    `Target: quick search ${quick.length}/${quick.length} under ${QUICK_MS} ms → ${quickMet ? "MET" : "MISSED"} (${quickPassed}/${quick.length})`,
  );

  const path = saveResult("search", {
    kind: "search",
    date: new Date().toISOString(),
    configuredModel: env.AI_MODEL_TEXT,
    fallbacks: env.AI_FALLBACK_MODELS_TEXT,
    jsonMode: env.AI_JSON_MODE,
    calls: stats,
    quick: { passed: quickPassed, of: quick.length, targetMet: quickMet, cases: quick },
    ask: { passed: askPassed, of: asked.length, targetMet: askMet, cases: asked },
  });
  console.log(`Saved ${path}`);
  return quickMet && (flags.has("--quick-only") || askMet);
}

withDb(main)
  .then((met) => process.exit(met ? 0 : 1))
  .catch((error) => {
    console.error(errorText(error));
    process.exit(1);
  });
