import { describe, expect, it } from "vitest";
import { emptyContact, type Contact } from "@/modules/contacts/contact.schema";
import { toCsv } from "@/modules/contacts/export";
import { toVcard, vcardFilename } from "@/modules/contacts/vcard";

const contact = (fields: Partial<Contact>): Contact => ({
  ...emptyContact(),
  id: "a".repeat(24),
  DepartmentId: "d".repeat(24),
  Source: "manual",
  CreatedAt: "2026-11-02T10:00:00.000Z",
  UpdatedAt: "2026-11-02T10:00:00.000Z",
  ...fields,
});

describe("toCsv", () => {
  const csv = toCsv([
    contact({
      FullName: 'أحمد "أبو علي" الربيعي',
      Mobile: "+9647701234567 | +9647801112233",
      Company: "=HYPERLINK(1)",
      City: "-Baghdad",
      Email: "@handle",
      Notes: "line one\nline two",
    }),
  ]);

  it("starts with a BOM and uses CRLF line ends", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("quotes every cell and doubles inner quotes", () => {
    const [header, row] = csv.slice(1).split("\r\n");
    expect(header).toBe(
      '"FullName","Position","Mobile","Company","City","Email","Sector","Notes","Source","CreatedAt"',
    );
    expect(row).toContain('"أحمد ""أبو علي"" الربيعي"');
    expect(row).toContain('"line one\nline two"');
  });

  it("protects +964 cells and formulas with a leading tab", () => {
    expect(csv).toContain('"\t+9647701234567 | +9647801112233"');
    expect(csv).toContain('"\t=HYPERLINK(1)"');
    expect(csv).toContain('"\t-Baghdad"');
    expect(csv).toContain('"\t@handle"');
  });

  it("adds the Department column only when names are given", () => {
    const withNames = toCsv([contact({ FullName: "A" })], new Map([["d".repeat(24), "Dept A"]]));
    expect(withNames).toContain('"Notes","Department","Source","CreatedAt"');
    expect(withNames).toContain('"Dept A","manual"');
  });
});

describe("vCard", () => {
  it("writes vCard 3.0 with one TEL and EMAIL per value", () => {
    const card = toVcard(
      contact({
        FullName: "Mustafa Kareem",
        Position: "Manager; Sales",
        Mobile: "+9647504451290 | +9647701234567",
        Company: "Korek, Telecom",
        City: "Erbil",
        Email: "a@b.com | c@d.com",
        Notes: "Office: 1\nFax: 2",
      }),
    );
    const lines = card.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCARD");
    expect(lines[1]).toBe("VERSION:3.0");
    expect(lines).toContain("FN:Mustafa Kareem");
    expect(lines).toContain("N:;Mustafa Kareem;;;");
    expect(lines).toContain("TEL;TYPE=CELL:+9647504451290");
    expect(lines).toContain("TEL;TYPE=CELL:+9647701234567");
    expect(lines).toContain("EMAIL;TYPE=INTERNET:a@b.com");
    expect(lines).toContain("EMAIL;TYPE=INTERNET:c@d.com");
    expect(lines).toContain("ORG:Korek\\, Telecom");
    expect(lines).toContain("TITLE:Manager\; Sales");
    expect(lines).toContain("ADR;TYPE=WORK:;;;Erbil;;;");
    expect(lines).toContain("NOTE:Office: 1\\nFax: 2");
    expect(card.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("falls back for FN: company, mobile, email, then Contact", () => {
    expect(toVcard(contact({ Company: "Asiacell" }))).toContain("FN:Asiacell\r\n");
    expect(toVcard(contact({ Mobile: "+9647701234567" }))).toContain("FN:+9647701234567\r\n");
    expect(toVcard(contact({ Email: "a@b.com" }))).toContain("FN:a@b.com\r\n");
    expect(toVcard(contact({}))).toContain("FN:Contact\r\n");
  });

  it("folds long lines at 75 bytes without cutting an Arabic character", () => {
    const card = toVcard(contact({ FullName: "أحمد", Notes: "ملاحظة ".repeat(40) }));
    for (const line of card.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�");
    }
    const unfolded = card.replace(/\r\n /g, "");
    expect(unfolded).toContain(`NOTE:${"ملاحظة ".repeat(40).trim()}`);
  });

  it("names the file from Latin letters and digits", () => {
    expect(vcardFilename(contact({ FullName: "Mohammed Al-Saadi" }))).toBe("Mohammed-Al-Saadi.vcf");
    expect(vcardFilename(contact({ FullName: "أحمد علي / Ahmed Ali" }))).toBe("Ahmed-Ali.vcf");
    expect(vcardFilename(contact({ FullName: "أحمد" }))).toBe("contact.vcf");
  });
});
