import { ContactInput, DEFAULT_SECTOR, FIELDS, matchSector, type Field } from "./contact.schema";
import { cleanContact, foldArabic, invalidEmails, normalizeEmail } from "./normalize";

// CSV import parsing (plan.md §8.9). Pure functions; the script does the database part.

/** UTF-8 (with or without BOM) or UTF-16 (LE / BE). */
export function decodeCsv(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString("utf16le");
  }
  // UTF-16 without a BOM: every other byte of plain text is zero.
  const sample = buffer.subarray(0, 200);
  const zerosAtOdd = sample.filter((byte, index) => index % 2 === 1 && byte === 0).length;
  const zerosAtEven = sample.filter((byte, index) => index % 2 === 0 && byte === 0).length;
  if (zerosAtOdd > sample.length / 4) return buffer.toString("utf16le");
  if (zerosAtEven > sample.length / 4) {
    return Buffer.from(buffer.subarray(0, buffer.length - (buffer.length % 2)))
      .swap16()
      .toString("utf16le");
  }
  return buffer.toString("utf8");
}

/** The delimiter (`,` `;` or tab) that appears most in the first line, outside quotes. */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && char in counts) counts[char]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180 CSV: quoted cells, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const ALIASES: Record<Field, string[]> = {
  FullName: [
    "fullname",
    "full name",
    "name",
    "contact name",
    "contact",
    "الاسم",
    "الاسم الكامل",
    "الاسم الثلاثي",
    "اسم",
  ],
  Position: [
    "position",
    "title",
    "job title",
    "job",
    "role",
    "المنصب",
    "الوظيفة",
    "المسمى الوظيفي",
    "العنوان الوظيفي",
    "الصفة",
  ],
  Mobile: [
    "mobile",
    "phone",
    "mobile phone",
    "mobile number",
    "phone number",
    "cell",
    "cell phone",
    "telephone",
    "tel",
    "الهاتف",
    "الموبايل",
    "الجوال",
    "رقم الهاتف",
    "رقم الموبايل",
    "رقم الجوال",
    "هاتف",
    "موبايل",
  ],
  Company: [
    "company",
    "organization",
    "organisation",
    "employer",
    "institution",
    "الشركة",
    "المؤسسة",
    "الجهة",
    "جهة العمل",
    "المنظمة",
    "شركة",
  ],
  City: ["city", "town", "المدينة", "المحافظة", "مدينة"],
  Email: [
    "email",
    "e mail",
    "email address",
    "mail",
    "البريد الالكتروني",
    "البريد",
    "الايميل",
    "ايميل",
    "بريد الكتروني",
  ],
  Sector: ["sector", "category", "القطاع", "التصنيف", "قطاع"],
  Notes: ["notes", "note", "comments", "comment", "ملاحظات", "الملاحظات", "ملاحظة"],
};

const headerKey = (value: string) =>
  foldArabic(value)
    .replace(/[_\-.:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Maps header cells to the 8 fields by English and Arabic names. `overrides` comes
 * from `--map Field="Header"`. The first column that matches a field wins.
 */
export function mapColumns(
  headers: string[],
  overrides: Partial<Record<Field, string>> = {},
): (Field | null)[] {
  const mapping: (Field | null)[] = headers.map(() => null);
  const used = new Set<Field>();
  for (const field of FIELDS) {
    const wanted = overrides[field];
    if (wanted === undefined) continue;
    const at = headers.findIndex((header) => headerKey(header) === headerKey(wanted));
    if (at < 0) throw new Error(`--map ${field}: no column named "${wanted}"`);
    mapping[at] = field;
    used.add(field);
  }
  headers.forEach((header, index) => {
    if (mapping[index]) return;
    const key = headerKey(header);
    const field = FIELDS.find(
      (candidate) => !used.has(candidate) && ALIASES[candidate].map(headerKey).includes(key),
    );
    if (field) {
      mapping[index] = field;
      used.add(field);
    }
  });
  return mapping;
}

export type ImportedRow =
  | { kind: "contact"; contact: ContactInput }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; reason: string };

/** One CSV row → a cleaned contact. There is no review step, so nothing is dropped silently. */
export function rowToContact(
  row: string[],
  headers: string[],
  mapping: (Field | null)[],
): ImportedRow {
  const values: Partial<Record<Field, string>> = {};
  const notes: string[] = [];
  headers.forEach((header, index) => {
    const value = (row[index] ?? "").trim();
    if (!value) return;
    const field = mapping[index];
    if (field) values[field] = value;
    else notes.push(`${header.trim() || `Column ${index + 1}`}: ${value}`);
  });

  let sector = DEFAULT_SECTOR;
  if (values.Sector) {
    const known = matchSector(values.Sector);
    if (known) sector = known;
    else notes.unshift(`Original sector: ${values.Sector}`);
  }
  const email = values.Email ?? "";
  const unreadable = invalidEmails(email);
  if (unreadable.length) notes.unshift(`Unreadable email: ${unreadable.join(", ")}`);

  const contact = cleanContact({
    FullName: values.FullName ?? "",
    Position: values.Position ?? "",
    Mobile: values.Mobile ?? "",
    Company: values.Company ?? "",
    City: values.City ?? "",
    Email: normalizeEmail(email),
    Sector: sector,
    Notes: [values.Notes, ...notes].filter(Boolean).join("; "),
  });

  if (!contact.FullName && !contact.Company && !contact.Mobile && !contact.Email) {
    return { kind: "skip", reason: "no name, company, mobile or email" };
  }
  const valid = ContactInput.safeParse(contact);
  if (!valid.success) {
    const issue = valid.error.issues[0];
    return { kind: "fail", reason: `${issue.path.join(".")}: ${issue.message}` };
  }
  return { kind: "contact", contact: valid.data };
}
