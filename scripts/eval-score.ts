// One comparison rule for all evals (plan.md §10).
import {
  FIELDS,
  splitMulti,
  type ContactInput,
  type Field,
} from "@/modules/contacts/contact.schema";
import { cleanContact, foldArabic } from "@/modules/contacts/normalize";

export const KEY_FIELDS = ["FullName", "Company", "Mobile", "Email"] as const satisfies Field[];

export type Miss = { contact: string; field: Field; expected: string; actual: string };
export type Tally = { correct: number; total: number };
export type CaseScore = {
  name: string;
  expectedCount: number;
  actualCount: number;
  missing: number;
  extra: number;
  fields: Record<Field, Tally>;
  misses: Miss[];
  /** Set when the case failed on an API error instead of being scored on output. */
  error?: string;
};

/** Folded, punctuation → space, whitespace collapsed. */
function comparable(value: string): string {
  return foldArabic(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

export function fieldCorrect(field: Field, expected: string, actual: string): boolean {
  if (expected === "" && actual === "") return true;
  if (expected === "" || actual === "") return false;
  if (field === "Mobile" || field === "Email")
    return sameSet(splitMulti(expected), splitMulti(actual));
  if (field === "Sector") return expected === actual;
  if (field === "Notes") {
    // Every labelled value of the expected notes appears somewhere in the actual notes.
    const squeeze = (value: string) => foldArabic(value).replace(/\s+/g, "");
    const haystack = squeeze(actual);
    return expected
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .every((item) => {
        const colon = item.indexOf(":");
        const value = colon >= 0 && colon < 25 ? item.slice(colon + 1) : item;
        return haystack.includes(squeeze(value));
      });
  }
  const want = comparable(expected);
  const got = comparable(actual);
  if (want === got) return true;
  // A bilingual expected value (a / b) is correct when every part appears in the actual value.
  const parts = expected.split(" / ").map(comparable).filter(Boolean);
  return parts.length > 1 && parts.every((part) => got.includes(part));
}

const emptyFields = () =>
  Object.fromEntries(FIELDS.map((field) => [field, { correct: 0, total: 0 }])) as Record<
    Field,
    Tally
  >;

const label = (contact: ContactInput) =>
  contact.FullName || contact.Company || contact.Mobile || contact.Email || "(empty)";

/** Scores one case: both sides are cleaned, then paired greedily by matching key fields. */
export function scoreCase(
  name: string,
  expectedRaw: ContactInput[],
  actualRaw: ContactInput[],
): CaseScore {
  const expected = expectedRaw.map(cleanContact);
  const actual = actualRaw.map(cleanContact);

  const pairs: { e: number; a: number; score: number }[] = [];
  expected.forEach((want, e) =>
    actual.forEach((got, a) => {
      const score = KEY_FIELDS.filter(
        (field) => want[field] !== "" && fieldCorrect(field, want[field], got[field]),
      ).length;
      if (score > 0) pairs.push({ e, a, score });
    }),
  );
  pairs.sort((x, y) => y.score - x.score || x.e - y.e || x.a - y.a);
  const pairOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const pair of pairs) {
    if (pairOf.has(pair.e) || taken.has(pair.a)) continue;
    pairOf.set(pair.e, pair.a);
    taken.add(pair.a);
  }

  const fields = emptyFields();
  const misses: Miss[] = [];
  expected.forEach((want, index) => {
    const at = pairOf.get(index);
    const got = at === undefined ? undefined : actual[at];
    for (const field of FIELDS) {
      fields[field].total++;
      // An unpaired expected contact counts all its fields wrong.
      if (got && fieldCorrect(field, want[field], got[field])) fields[field].correct++;
      else {
        misses.push({
          contact: label(want),
          field,
          expected: want[field],
          actual: got ? got[field] : "(contact missing)",
        });
      }
    }
  });

  return {
    name,
    expectedCount: expected.length,
    actualCount: actual.length,
    missing: expected.length - pairOf.size,
    extra: actual.length - taken.size,
    fields,
    misses,
  };
}

/** A case that failed on an API error: counted as failed (all fields wrong). */
export function failedCase(name: string, expected: ContactInput[], error: string): CaseScore {
  return { ...scoreCase(name, expected, []), error };
}

export type Summary = {
  cases: number;
  failedCases: number;
  keyAccuracy: number;
  allAccuracy: number;
  perField: Record<Field, number>;
  missing: number;
  extra: number;
};

const ratio = (tally: Tally) => (tally.total === 0 ? 1 : tally.correct / tally.total);

export function summarize(cases: CaseScore[]): Summary {
  const total = emptyFields();
  for (const item of cases) {
    for (const field of FIELDS) {
      total[field].correct += item.fields[field].correct;
      total[field].total += item.fields[field].total;
    }
  }
  const sum = (fields: readonly Field[]) =>
    fields.reduce(
      (acc, field) => ({
        correct: acc.correct + total[field].correct,
        total: acc.total + total[field].total,
      }),
      { correct: 0, total: 0 },
    );
  return {
    cases: cases.length,
    failedCases: cases.filter((item) => item.error).length,
    keyAccuracy: ratio(sum(KEY_FIELDS)),
    allAccuracy: ratio(sum(FIELDS)),
    perField: Object.fromEntries(FIELDS.map((field) => [field, ratio(total[field])])) as Record<
      Field,
      number
    >,
    missing: cases.reduce((acc, item) => acc + item.missing, 0),
    extra: cases.reduce((acc, item) => acc + item.extra, 0),
  };
}

export const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function formatReport(cases: CaseScore[]): string {
  const lines: string[] = [];
  for (const item of cases) {
    const key = ratio(
      KEY_FIELDS.reduce(
        (acc, field) => ({
          correct: acc.correct + item.fields[field].correct,
          total: acc.total + item.fields[field].total,
        }),
        { correct: 0, total: 0 },
      ),
    );
    lines.push(
      `${item.error ? "ERROR" : "     "} ${item.name.padEnd(34)} contacts ${item.actualCount}/${item.expectedCount}` +
        `  key ${percent(key).padStart(6)}  missing ${item.missing}  extra ${item.extra}` +
        (item.error ? `  — ${item.error}` : ""),
    );
  }
  const summary = summarize(cases);
  lines.push("", "Per field:");
  for (const field of FIELDS)
    lines.push(`  ${field.padEnd(9)} ${percent(summary.perField[field])}`);
  lines.push(
    "",
    `Key fields (${KEY_FIELDS.join(", ")}): ${percent(summary.keyAccuracy)}`,
    `All fields: ${percent(summary.allAccuracy)}`,
    `Missing contacts: ${summary.missing} · extra contacts: ${summary.extra} · cases failed on an API error: ${summary.failedCases}`,
  );
  const misses = cases.flatMap((item) => item.misses.map((miss) => ({ case: item.name, ...miss })));
  if (misses.length) {
    lines.push("", `Misses (${misses.length}):`);
    for (const miss of misses) {
      lines.push(
        `  ${miss.case} · ${miss.contact} · ${miss.field}: expected "${miss.expected}" got "${miss.actual}"`,
      );
    }
  }
  return lines.join("\n");
}
