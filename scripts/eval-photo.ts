// npm run eval:photo [-- <name>] [--limit N] — accuracy of photo → contacts (real API).
// Synthetic fixtures are named pNN-…; any other photo in the folder is a real phone
// photo and is reported separately.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { config } from "@/lib/config";
import type { ContactInput } from "@/modules/contacts/contact.schema";
import { extractContactsFromPhoto } from "@/modules/extraction/extract-photo";
import { prepareImage } from "@/modules/extraction/prepare-image";
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

const DIR = "tests/fixtures/photos";
const IMAGE = /\.(jpe?g|png|webp|heic|heif)$/i;
const FIELD_TARGET = 0.9;
const COUNT_TARGET = 0.9;

type PhotoCase = CaseScore & { cardCount: number | null; countCorrect: boolean };

function report(title: string, cases: PhotoCase[]): { countOk: number; all: number } {
  const countOk = cases.filter((item) => item.countCorrect).length;
  const summary = summarize(cases);
  console.log(`\n===== ${title} (${cases.length}) =====\n${formatReport(cases)}`);
  console.log(`\nCard count right: ${countOk}/${cases.length}`);
  const byCount = new Map<number, { ok: number; total: number }>();
  for (const item of cases) {
    const bucket = byCount.get(item.expectedCount) ?? { ok: 0, total: 0 };
    bucket.total++;
    if (item.countCorrect) bucket.ok++;
    byCount.set(item.expectedCount, bucket);
  }
  for (const [cards, bucket] of [...byCount].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${cards}-card photos: count right on ${bucket.ok}/${bucket.total}`);
  }
  return { countOk, all: summary.allAccuracy };
}

async function main() {
  const { limit, name } = parseArgs();
  const env = config();
  let files = readdirSync(DIR)
    .filter(
      (file) => IMAGE.test(file) && existsSync(`${DIR}/${file.replace(IMAGE, "")}.expected.json`),
    )
    .sort();
  if (name) files = files.filter((file) => file.includes(name));
  if (limit) files = files.slice(0, limit);
  if (files.length === 0) throw new Error("No photo fixtures match.");

  console.log(`eval:photo — ${files.length} photos\n${describeSetup("vision")}\n`);
  const { stats, stop } = trackCalls();
  const cases: (PhotoCase & { synthetic: boolean })[] = [];
  for (const [index, file] of files.entries()) {
    const fixture = file.replace(IMAGE, "");
    const expected = JSON.parse(
      readFileSync(`${DIR}/${fixture}.expected.json`, "utf8"),
    ) as ContactInput[];
    const synthetic = /^p\d\d-/.test(fixture);
    try {
      const image = await prepareImage(readFileSync(`${DIR}/${file}`));
      const { cardCount, contacts } = await extractContactsFromPhoto(image);
      cases.push({
        ...scoreCase(fixture, expected, contacts),
        cardCount,
        countCorrect: cardCount === expected.length && contacts.length === expected.length,
        synthetic,
      });
    } catch (error) {
      cases.push({
        ...failedCase(fixture, expected, errorText(error)),
        cardCount: null,
        countCorrect: false,
        synthetic,
      });
    }
    if (index < files.length - 1) await pace();
  }
  stop();

  const synthetic = cases.filter((item) => item.synthetic);
  const real = cases.filter((item) => !item.synthetic);
  const result = synthetic.length ? report("Synthetic photos", synthetic) : { countOk: 0, all: 0 };
  if (real.length) report("Real phone photos (reported separately)", real);
  else
    console.log(
      "\nNo real phone photos in the folder yet: the photo target does not count as met without at least 3.",
    );

  const met =
    synthetic.length > 0 &&
    result.countOk / synthetic.length >= COUNT_TARGET &&
    result.all >= FIELD_TARGET;
  console.log(`\n${describeCalls(stats)}`);
  console.log(
    `\nTarget (synthetic): card count right on ≥ 9/10 and all fields ≥ ${percent(FIELD_TARGET)} → ` +
      `${met ? "MET" : "MISSED"} (${result.countOk}/${synthetic.length}, ${percent(result.all)})`,
  );
  const path = saveResult("photo", {
    kind: "photo",
    date: new Date().toISOString(),
    configuredModel: env.AI_MODEL_VISION,
    fallbacks: env.AI_FALLBACK_MODELS_VISION,
    jsonMode: env.AI_JSON_MODE,
    calls: stats,
    synthetic: {
      summary: summarize(synthetic),
      countCorrect: result.countOk,
      of: synthetic.length,
    },
    real: {
      summary: summarize(real),
      countCorrect: real.filter((item) => item.countCorrect).length,
      of: real.length,
    },
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
