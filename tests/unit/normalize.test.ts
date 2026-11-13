import { describe, expect, it } from "vitest";
import { DEFAULT_SECTOR, emptyContact } from "@/modules/contacts/contact.schema";
import {
  cleanContact,
  cleanForReview,
  foldArabic,
  invalidEmails,
  matchSector,
  normalizeDigits,
  normalizeEmail,
  normalizeMobile,
  normalizeSector,
  normalizeText,
  toMatchKeys,
  unusualMobiles,
} from "@/modules/contacts/normalize";

describe("normalizeMobile", () => {
  it.each([
    ["07701234567", "+9647701234567"],
    ["0770 123 4567", "+9647701234567"],
    ["7701234567", "+9647701234567"],
    ["+964 770 123 4567", "+9647701234567"],
    ["009647701234567", "+9647701234567"],
    ["9647701234567", "+9647701234567"],
    ["+964 (0) 770 123 4567", "+9647701234567"],
    ["96407701234567", "+9647701234567"],
    ["٠٧٨٠١١١٢٢٣٣", "+9647801112233"],
    ["۰۷۸۰۱۱۱۲۲۳۳", "+9647801112233"],
    ["M: +964 750 445 1290", "+9647504451290"],
    ["Mobile: 0750-445-1290", "+9647504451290"],
  ])("Iraqi mobile %s", (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each([
    ["+44 20 7946 0958", "+442079460958"],
    ["0044 20 7946 0958", "+442079460958"],
    ["+1 (212) 555-0147", "+12125550147"],
    ["+964 1 717 0000", "+96417170000"],
    ["964662220011", "+964662220011"],
    ["2125550147", "2125550147"],
  ])("foreign or landline %s", (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it("keeps numbers it cannot format as written", () => {
    expect(normalizeMobile("0770 123 456")).toBe("0770 123 456"); // looks Iraqi, wrong length
    expect(normalizeMobile("+964 770 123 45")).toBe("+964 770 123 45");
    expect(normalizeMobile("07701234567 ext 12")).toBe("07701234567 ext 12");
    expect(normalizeMobile("12345")).toBe("12345");
  });

  it("splits several numbers and removes repeats", () => {
    expect(normalizeMobile("07701234567, 07801112233")).toBe("+9647701234567 | +9647801112233");
    expect(normalizeMobile("07701234567 / 0770 123 4567")).toBe("+9647701234567");
    expect(normalizeMobile("07701234567 or 07801112233")).toBe("+9647701234567 | +9647801112233");
    expect(normalizeMobile("07701234567 و 07801112233")).toBe("+9647701234567 | +9647801112233");
    expect(normalizeMobile("07701234567\n+44 20 7946 0958")).toBe("+9647701234567 | +442079460958");
  });

  it("splits two numbers written with only a space between", () => {
    expect(normalizeMobile("07701234567 07801112233")).toBe("+9647701234567 | +9647801112233");
    expect(normalizeMobile("0770 123 4567 +964 780 111 2233")).toBe(
      "+9647701234567 | +9647801112233",
    );
  });

  it("keeps a long piece untouched when a part is not a plausible number", () => {
    expect(normalizeMobile("07701234567 12 345")).toBe("07701234567 12 345");
  });

  it("drops pieces without digits and never invents a number", () => {
    expect(normalizeMobile("")).toBe("");
    expect(normalizeMobile("n/a")).toBe("");
    expect(normalizeMobile("‏07701234567‎")).toBe("+9647701234567");
  });

  it("flags unusual numbers for the review hint", () => {
    expect(unusualMobiles("+9647701234567 | 0770 123 456 | 2125550147")).toEqual([
      "0770 123 456",
      "2125550147",
    ]);
    expect(unusualMobiles("")).toEqual([]);
  });
});

describe("emails", () => {
  it("normalizes several emails", () => {
    expect(normalizeEmail("Ali@Example.com, <sara@uni.edu.iq>; mailto:info@x.org.")).toBe(
      "ali@example.com | sara@uni.edu.iq | info@x.org",
    );
    expect(normalizeEmail("a@b.com | a@b.com")).toBe("a@b.com");
  });

  it("separates invalid emails", () => {
    expect(invalidEmails("ali@example, sara@uni.edu.iq, nothing")).toEqual([
      "ali@example",
      "nothing",
    ]);
    expect(normalizeEmail("ali@example, sara@uni.edu.iq")).toBe("sara@uni.edu.iq");
    expect(invalidEmails("")).toEqual([]);
  });
});

describe("text", () => {
  it("removes invisible marks and collapses whitespace", () => {
    expect(normalizeText("  ‫أحمد   علي‬ \n")).toBe("أحمد علي");
  });

  it("converts digits", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789 0123456789");
  });

  it("folds Arabic for comparing only", () => {
    expect(foldArabic("أَحْمَد")).toBe("احمد");
    expect(foldArabic("إبراهيم آدم")).toBe("ابراهيم ادم");
    expect(foldArabic("مدرســة")).toBe("مدرسه");
    expect(foldArabic("مصطفى")).toBe("مصطفي");
    expect(foldArabic("علی کریم")).toBe("علي كريم");
    expect(foldArabic("Mohammed")).toBe("mohammed");
  });
});

describe("sector", () => {
  it("matches exactly, case-insensitively and by short name", () => {
    expect(matchSector("Universities & Education")).toBe("Universities & Education");
    expect(matchSector("ngos & civil society")).toBe("NGOs & Civil Society");
    expect(matchSector("Bank")).toBe("Businesses & Financial Institutions");
    expect(matchSector("embassy")).toBe("Embassies & International Organizations");
    expect(matchSector("Space agencies")).toBeUndefined();
    expect(normalizeSector("Space agencies")).toBe(DEFAULT_SECTOR);
    expect(normalizeSector("")).toBe(DEFAULT_SECTOR);
  });
});

describe("cleanContact", () => {
  const raw = {
    ...emptyContact(),
    FullName: "  أحمد   الربيعي ",
    Mobile: "٠٧٨٠١١١٢٢٣٣, 07701234567",
    Email: "Ahmed@Uni.edu.iq, broken@",
    Notes: " Office: +964 1 717 0000 ‏",
  };

  it("cleans every field and adds nothing", () => {
    const clean = cleanContact(raw);
    expect(clean.FullName).toBe("أحمد الربيعي");
    expect(clean.Mobile).toBe("+9647801112233 | +9647701234567");
    expect(clean.Email).toBe("ahmed@uni.edu.iq");
    expect(clean.Notes).toBe("Office: +964 1 717 0000");
    expect(clean.Company).toBe("");
    expect(clean.Sector).toBe(DEFAULT_SECTOR);
  });

  it("keeps invalid emails for the review list", () => {
    expect(cleanForReview(raw).Email).toBe("ahmed@uni.edu.iq | broken@");
  });

  it("derives match keys", () => {
    const keys = toMatchKeys({ Mobile: "+9647801112233 | 0770 123 456 | 123", Email: "a@b.com" });
    expect(keys._mobiles).toEqual(["+9647801112233", "0770123456"]);
    expect(keys._emails).toEqual(["a@b.com"]);
  });
});
