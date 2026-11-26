import { z } from "zod";

// The single source of truth for a contact: fields, sectors, sources and schemas.

export const FIELDS = [
  "FullName",
  "Position",
  "Mobile",
  "Company",
  "City",
  "Email",
  "Sector",
  "Notes",
] as const;
export type Field = (typeof FIELDS)[number];

export const SECTORS = [
  "Ministries & Government",
  "Businesses & Financial Institutions",
  "Embassies & International Organizations",
  "Universities & Education",
  "NGOs & Civil Society",
  "Professional & Other Contacts",
] as const;
export type Sector = (typeof SECTORS)[number];
export const DEFAULT_SECTOR: Sector = "Professional & Other Contacts";

export const SOURCES = ["text", "photo", "manual", "import"] as const;
export type Source = (typeof SOURCES)[number];

/** Several mobiles or emails in one field. A pipe, so CSV cells never contain commas. */
export const MULTI_SEPARATOR = " | ";

export function splitMulti(value: string): string[] {
  return value
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export const MAX_FIELD = 300;
export const MAX_NOTES = 2000;

const SECTOR_ALIASES: Record<string, Sector> = {
  ministry: "Ministries & Government",
  ministries: "Ministries & Government",
  government: "Ministries & Government",
  business: "Businesses & Financial Institutions",
  businesses: "Businesses & Financial Institutions",
  company: "Businesses & Financial Institutions",
  bank: "Businesses & Financial Institutions",
  banking: "Businesses & Financial Institutions",
  embassy: "Embassies & International Organizations",
  embassies: "Embassies & International Organizations",
  "international organization": "Embassies & International Organizations",
  university: "Universities & Education",
  universities: "Universities & Education",
  education: "Universities & Education",
  ngo: "NGOs & Civil Society",
  ngos: "NGOs & Civil Society",
  "civil society": "NGOs & Civil Society",
  professional: "Professional & Other Contacts",
  other: "Professional & Other Contacts",
};

/** Exact match, then case-insensitive, then short names. `undefined` when unknown. */
export function matchSector(value: unknown): Sector | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if ((SECTORS as readonly string[]).includes(text)) return text as Sector;
  const lower = text.toLowerCase();
  return SECTORS.find((sector) => sector.toLowerCase() === lower) ?? SECTOR_ALIASES[lower];
}

export function normalizeSector(value: unknown): Sector {
  return matchSector(value) ?? DEFAULT_SECTOR;
}

const text = z.string().max(MAX_FIELD);
const notes = z.string().max(MAX_NOTES);
const sector = z.enum(SECTORS);

/** All 8 fields required (unknown = ""). What gets stored. */
export const ContactInput = z.object({
  FullName: text,
  Position: text,
  Mobile: text,
  Company: text,
  City: text,
  Email: text,
  Sector: sector,
  Notes: notes,
});
export type ContactInput = z.infer<typeof ContactInput>;

// AI output is untrusted: a small model may send null, a number, or a sector nickname.
// The JSON Schema sent to the model is still the strict one (8 required strings).
const aiText = (max: number) =>
  z.preprocess(
    (value) => (value == null ? "" : typeof value === "number" ? String(value) : value),
    z.string().max(max),
  );

/** `ContactInput` as the AI returns it, read tolerantly. */
export const AiContact = z.object({
  FullName: aiText(MAX_FIELD),
  Position: aiText(MAX_FIELD),
  Mobile: aiText(MAX_FIELD),
  Company: aiText(MAX_FIELD),
  City: aiText(MAX_FIELD),
  Email: aiText(MAX_FIELD),
  Sector: z.preprocess((value) => normalizeSector(value), sector),
  Notes: aiText(MAX_NOTES),
});

/** Missing fields default to "" (Sector → DEFAULT_SECTOR). Used by POST /api/contacts. */
export const ContactInputLoose = z.object({
  FullName: text.default(""),
  Position: text.default(""),
  Mobile: text.default(""),
  Company: text.default(""),
  City: text.default(""),
  Email: text.default(""),
  Sector: sector.default(DEFAULT_SECTOR),
  Notes: notes.default(""),
});

/** Any subset of the 8 fields. Used by PATCH. Unknown keys (DepartmentId…) are dropped. */
export const ContactPatch = ContactInput.partial();
export type ContactPatch = z.infer<typeof ContactPatch>;

export const SaveContactsBody = z.object({
  source: z.enum(SOURCES),
  contacts: z.array(ContactInputLoose).min(1).max(200),
});

/** A contact as the API returns it. */
export type Contact = ContactInput & {
  id: string;
  DepartmentId: string | null;
  Source: Source;
  CreatedAt: string;
  UpdatedAt: string;
};

/** A suggested contact in the review list, with duplicate marks. */
export type ReviewContact = ContactInput & {
  duplicateOfId?: string;
  duplicateOfName?: string;
  /** Index of an earlier contact in the same batch. */
  duplicateInBatch?: number;
};

export function emptyContact(): ContactInput {
  return {
    FullName: "",
    Position: "",
    Mobile: "",
    Company: "",
    City: "",
    Email: "",
    Sector: DEFAULT_SECTOR,
    Notes: "",
  };
}

// ---------- Query inputs (validated by the routes) ----------

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const id = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

/** The table filters: exact matches, plus whole days in the app time zone. */
export const ContactFilters = z.object({
  Company: z.string().max(MAX_FIELD).optional(),
  City: z.string().max(MAX_FIELD).optional(),
  Sector: z.enum(SECTORS).optional(),
  DepartmentId: id.optional(),
  CreatedBy: id.optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
});
export type ContactFilters = z.infer<typeof ContactFilters>;

export const SORT_FIELDS = [...FIELDS, "CreatedAt", "UpdatedAt"] as const;

export const ListContactsQuery = ContactFilters.extend({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(SORT_FIELDS).default("CreatedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export type ListContactsQuery = z.infer<typeof ListContactsQuery>;

export const QuickSearchQuery = z.object({
  q: z.string().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

export const VALUE_FIELDS = ["Company", "City", "Sector"] as const;
export const ValuesQuery = z.object({ field: z.enum(VALUE_FIELDS) });

/** What Ask AI may search by (docs/tools.md §6). Every field is optional. */
export const SearchParams = z.object({
  text: z.string().max(200).optional(),
  FullName: z.string().max(200).optional(),
  Position: z.string().max(200).optional(),
  Company: z.string().max(200).optional(),
  City: z.string().max(200).optional(),
  Sector: z.enum(SECTORS).optional(),
  dateFrom: day.optional(),
  dateTo: day.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
export type SearchParams = z.infer<typeof SearchParams>;
