import { describe, expect, it } from "vitest";
import { emptyContact, type ContactInput } from "@/modules/contacts/contact.schema";
import { failedCase, fieldCorrect, scoreCase, summarize } from "../../scripts/eval-score";

const c = (fields: Partial<ContactInput>): ContactInput => ({ ...emptyContact(), ...fields });

describe("fieldCorrect", () => {
  it("compares text after folding, ignoring punctuation and spacing", () => {
    expect(fieldCorrect("FullName", "أحمد الربيعي", "احمد  الربيعي")).toBe(true);
    expect(fieldCorrect("Company", "Al-Rasheed Bank", "al rasheed bank.")).toBe(true);
    expect(fieldCorrect("FullName", "Mohammed Al-Saadi", "Mohamed Al-Saadi")).toBe(false);
  });

  it("accepts a bilingual value when every part appears", () => {
    expect(fieldCorrect("FullName", "أحمد علي / Ahmed Ali", "Ahmed Ali / أحمد علي")).toBe(true);
    expect(fieldCorrect("FullName", "أحمد علي / Ahmed Ali", "Ahmed Ali")).toBe(false);
  });

  it("empty rules: both empty is correct, an invented or missing value is wrong", () => {
    expect(fieldCorrect("City", "", "")).toBe(true);
    expect(fieldCorrect("City", "", "Baghdad")).toBe(false);
    expect(fieldCorrect("City", "Baghdad", "")).toBe(false);
  });

  it("compares mobiles and emails as sets", () => {
    expect(
      fieldCorrect("Mobile", "+9647701234567 | +9647801112233", "+9647801112233 | +9647701234567"),
    ).toBe(true);
    expect(fieldCorrect("Mobile", "+9647701234567 | +9647801112233", "+9647701234567")).toBe(false);
    expect(fieldCorrect("Email", "a@b.com", "a@b.com | c@d.com")).toBe(false);
  });

  it("sector is exact; notes need every labelled value somewhere", () => {
    expect(fieldCorrect("Sector", "NGOs & Civil Society", "NGOs & Civil Society")).toBe(true);
    expect(fieldCorrect("Sector", "NGOs & Civil Society", "Universities & Education")).toBe(false);
    const expected = "Office: +964 1 717 0000; Website: example.com";
    expect(
      fieldCorrect("Notes", expected, "Website: example.com; Tel: +96417170000; Fax: 123"),
    ).toBe(true);
    expect(fieldCorrect("Notes", expected, "Website: example.com")).toBe(false);
    expect(fieldCorrect("Notes", "Office: ٠١ ٧١٩ ٤٤٠٠", "Office: 01 719 4400")).toBe(true);
  });
});

describe("scoreCase", () => {
  const expected = [
    c({
      FullName: "Mustafa Kareem",
      Company: "Korek Telecom",
      Mobile: "+9647504451290",
      Email: "m@korek.test",
      City: "Erbil",
    }),
    c({ FullName: "زينب كاظم", Company: "مستشفى النجف", Mobile: "07801112233" }),
  ];

  it("cleans both sides and pairs contacts in any order", () => {
    const actual = [
      c({ FullName: "زينب كاظم", Company: "مستشفى النجف", Mobile: "+964 780 111 2233" }),
      c({
        FullName: "Mustafa Kareem",
        Company: "Korek Telecom",
        Mobile: "0750 445 1290",
        Email: "M@Korek.test",
        City: "Erbil",
      }),
    ];
    const score = scoreCase("case", expected, actual);
    expect(score.misses).toEqual([]);
    expect(score.missing).toBe(0);
    expect(score.extra).toBe(0);
    expect(summarize([score]).keyAccuracy).toBe(1);
    expect(summarize([score]).allAccuracy).toBe(1);
  });

  it("counts wrong fields, missing and extra contacts", () => {
    const actual = [
      c({
        FullName: "Mustafa Kareem",
        Company: "Korek",
        Mobile: "+9647504451290",
        Email: "m@korek.test",
        City: "Erbil",
      }),
      c({ FullName: "Somebody Else", Mobile: "+9647000000000" }),
    ];
    const score = scoreCase("case", expected, actual);
    expect(score.missing).toBe(1);
    expect(score.extra).toBe(1);
    expect(score.fields.Company).toEqual({ correct: 0, total: 2 });
    expect(score.fields.FullName).toEqual({ correct: 1, total: 2 });
    // The unpaired expected contact counts all 8 fields wrong; the paired one has 1 miss.
    expect(score.misses).toHaveLength(9);
    const summary = summarize([score]);
    expect(summary.keyAccuracy).toBeCloseTo(3 / 8);
    expect(summary.allAccuracy).toBeCloseTo(7 / 16);
  });

  it("a case that failed on an API error counts every field wrong and is listed", () => {
    const failed = failedCase("case", expected, "AI service is busy.");
    expect(failed.error).toBe("AI service is busy.");
    const summary = summarize([failed]);
    expect(summary.allAccuracy).toBe(0);
    expect(summary.failedCases).toBe(1);
  });

  it("an expected empty list with an empty answer is a perfect case", () => {
    const summary = summarize([scoreCase("none", [], [])]);
    expect(summary.keyAccuracy).toBe(1);
    expect(scoreCase("none", [], [c({ FullName: "Invented" })]).extra).toBe(1);
  });
});
