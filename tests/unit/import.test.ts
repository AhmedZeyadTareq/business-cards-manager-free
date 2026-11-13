import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SECTOR } from "@/modules/contacts/contact.schema";
import {
  decodeCsv,
  detectDelimiter,
  mapColumns,
  parseCsv,
  rowToContact,
} from "@/modules/contacts/import";

describe("decodeCsv", () => {
  const text = "الاسم,name\nأحمد,Ali\n";
  it("reads UTF-8 with and without BOM, and UTF-16 LE / BE", () => {
    expect(decodeCsv(Buffer.from(text, "utf8"))).toBe(text);
    expect(
      decodeCsv(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")])),
    ).toBe(text);
    const le = Buffer.from(text, "utf16le");
    expect(decodeCsv(Buffer.concat([Buffer.from([0xff, 0xfe]), le]))).toBe(text);
    const be = Buffer.from(le).swap16();
    expect(decodeCsv(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(text);
    expect(decodeCsv(Buffer.from("name,phone\nAli,123\n", "utf16le"))).toBe(
      "name,phone\nAli,123\n",
    );
  });
});

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, line breaks in cells and CRLF", () => {
    expect(parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\nlast,,\r\n')).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "line1\nline2"],
      ["last", "", ""],
    ]);
  });

  it("detects the delimiter from the first line", () => {
    expect(detectDelimiter("a;b;c\n1,5;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n")).toBe("\t");
    expect(detectDelimiter('"x;y",b,c\n')).toBe(",");
    expect(parseCsv("name;city\nAli;Baghdad")).toEqual([
      ["name", "city"],
      ["Ali", "Baghdad"],
    ]);
  });
});

describe("mapColumns", () => {
  it("maps English and Arabic headers", () => {
    expect(
      mapColumns([
        "Full Name",
        "Job Title",
        "Phone",
        "Organization",
        "City",
        "E-mail",
        "Category",
        "Notes",
        "Fax",
      ]),
    ).toEqual([
      "FullName",
      "Position",
      "Mobile",
      "Company",
      "City",
      "Email",
      "Sector",
      "Notes",
      null,
    ]);
    expect(
      mapColumns([
        "الاسم",
        "المنصب",
        "الهاتف",
        "الشركة",
        "المدينة",
        "البريد الإلكتروني",
        "القطاع",
        "ملاحظات",
      ]),
    ).toEqual(["FullName", "Position", "Mobile", "Company", "City", "Email", "Sector", "Notes"]);
  });

  it("the first matching column wins and --map overrides", () => {
    expect(mapColumns(["phone", "mobile"])).toEqual(["Mobile", null]);
    expect(mapColumns(["Display Name", "name"], { FullName: "Display Name" })).toEqual([
      "FullName",
      null,
    ]);
    expect(() => mapColumns(["a"], { FullName: "missing" })).toThrow(/no column named/);
  });
});

describe("rowToContact", () => {
  const headers = ["name", "phone", "email", "sector", "Fax", "notes"];
  const mapping = mapColumns(headers);

  it("cleans the row and moves what does not fit into Notes", () => {
    const result = rowToContact(
      ["  Ali Hassan ", "0770 123 4567", "ali@x.test, broken@", "Media", "01 555", "VIP"],
      headers,
      mapping,
    );
    expect(result).toEqual({
      kind: "contact",
      contact: {
        FullName: "Ali Hassan",
        Position: "",
        Mobile: "+9647701234567",
        Company: "",
        City: "",
        Email: "ali@x.test",
        Sector: DEFAULT_SECTOR,
        Notes: "VIP; Unreadable email: broken@; Original sector: Media; Fax: 01 555",
      },
    });
  });

  it("accepts sector short names", () => {
    const result = rowToContact(["A", "", "", "bank", "", ""], headers, mapping);
    expect(result.kind === "contact" && result.contact.Sector).toBe(
      "Businesses & Financial Institutions",
    );
  });

  it("skips empty rows and fails rows that do not fit the schema", () => {
    expect(rowToContact(["", "", "", "", "", ""], headers, mapping).kind).toBe("skip");
    expect(rowToContact(["", "", "", "NGO", "123", "only notes"], headers, mapping).kind).toBe(
      "skip",
    );
    expect(rowToContact(["x".repeat(301), "", "", "", "", ""], headers, mapping).kind).toBe("fail");
  });
});

describe("the sample CSV", () => {
  it("parses into the expected mix of rows", () => {
    const rows = parseCsv(decodeCsv(readFileSync("tests/fixtures/import/sample.csv")));
    const headers = rows[0];
    const mapping = mapColumns(headers);
    expect(mapping.slice(0, 7)).toEqual([
      "FullName",
      "Position",
      "Mobile",
      "Company",
      "City",
      "Email",
      "Sector",
    ]);
    const results = rows.slice(1).map((row) => rowToContact(row, headers, mapping));
    expect(results.filter((result) => result.kind === "skip")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "fail")).toHaveLength(0);
    const notes = results.flatMap((result) =>
      result.kind === "contact" ? [result.contact.Notes] : [],
    );
    expect(notes.some((note) => note.includes("Unreadable email:"))).toBe(true);
    expect(notes.some((note) => note.includes("Original sector:"))).toBe(true);
  });
});
