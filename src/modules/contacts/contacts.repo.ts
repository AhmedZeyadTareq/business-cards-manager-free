import { ObjectId, type Document, type Filter } from "mongodb";
import { config } from "@/lib/config";
import { endOfDay, isDay, startOfDay } from "@/lib/dates";
import { scopeFilter, toObjectId, type Scope, type Writer } from "@/modules/accounts/scope";
import { writeAudit } from "@/modules/audit/audit.repo";
import { collections, currentDatabaseName, type ContactDoc } from "@/modules/db/mongo";
import { SEARCH_INDEX } from "@/modules/db/setup";
import { AppError } from "@/modules/shared/errors";
import {
  FIELDS,
  type Contact,
  type ContactFilters,
  type ContactInput,
  type ContactPatch,
  type ListContactsQuery,
  type ReviewContact,
  type SearchParams,
  type Source,
} from "./contact.schema";
import { cleanContact, invalidEmails, normalizeDigits, toMatchKeys } from "./normalize";

// The only file that reads or writes contacts. Every read takes a Scope and every
// write takes a Writer; the scope is always AND-ed with the caller's filter.

const NOT_FOUND = "Contact not found.";

function toContact(doc: ContactDoc): Contact {
  return {
    id: doc._id.toHexString(),
    FullName: doc.FullName ?? "",
    Position: doc.Position ?? "",
    Mobile: doc.Mobile ?? "",
    Company: doc.Company ?? "",
    City: doc.City ?? "",
    Email: doc.Email ?? "",
    Sector: doc.Sector,
    Notes: doc.Notes ?? "",
    DepartmentId: doc.DepartmentId ? doc.DepartmentId.toHexString() : null,
    Source: doc.Source,
    CreatedAt: doc.CreatedAt.toISOString(),
    UpdatedAt: doc.UpdatedAt.toISOString(),
  };
}

function fieldsOf(doc: ContactInput): ContactInput {
  const out = {} as Record<string, string>;
  for (const field of FIELDS) out[field] = doc[field] ?? "";
  return out as ContactInput;
}

const contactName = (contact: ContactInput) => contact.FullName || contact.Company;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole days in the app time zone, as a range on CreatedAt. */
function dateRange(from?: string, to?: string): { $gte?: Date; $lt?: Date } | undefined {
  const zone = config().APP_TIME_ZONE;
  const range: { $gte?: Date; $lt?: Date } = {};
  if (from && isDay(from)) range.$gte = startOfDay(from, zone);
  if (to && isDay(to)) range.$lt = endOfDay(to, zone);
  return range.$gte || range.$lt ? range : undefined;
}

/** The scope AND the caller's filters: a DepartmentId filter can only narrow the scope. */
function filterFor(scope: Scope, filters: ContactFilters): Filter<ContactDoc> {
  const and: Filter<ContactDoc>[] = [scopeFilter(scope)];
  if (filters.Company) and.push({ Company: filters.Company });
  if (filters.City) and.push({ City: filters.City });
  if (filters.Sector) and.push({ Sector: filters.Sector });
  if (filters.DepartmentId) {
    and.push({ DepartmentId: toObjectId(filters.DepartmentId) ?? new ObjectId() });
  }
  if (filters.CreatedBy) and.push({ CreatedBy: toObjectId(filters.CreatedBy) ?? new ObjectId() });
  const range = dateRange(filters.dateFrom, filters.dateTo);
  if (range) and.push({ CreatedAt: range });
  return { $and: and };
}

// ---------- Reads ----------

export async function listContacts(
  scope: Scope,
  query: ListContactsQuery,
): Promise<{ items: Contact[]; total: number }> {
  const { contacts } = collections();
  const filter = filterFor(scope, query);
  const direction = query.dir === "asc" ? 1 : -1;
  const byDate = query.sort === "CreatedAt" || query.sort === "UpdatedAt";
  let cursor = contacts
    .find(filter)
    .sort({ [query.sort]: direction, _id: -1 })
    .skip((query.page - 1) * query.pageSize)
    .limit(query.pageSize);
  // Text columns sort without regard to letter case.
  if (!byDate) cursor = cursor.collation({ locale: "en", strength: 2 });
  const [docs, total] = await Promise.all([cursor.toArray(), contacts.countDocuments(filter)]);
  return { items: docs.map(toContact), total };
}

/** The same filters, newest first, no paging (export). */
export async function listAllContacts(scope: Scope, filters: ContactFilters): Promise<Contact[]> {
  const docs = await collections()
    .contacts.find(filterFor(scope, filters))
    .sort({ CreatedAt: -1, _id: -1 })
    .toArray();
  return docs.map(toContact);
}

const TEXT_PATHS = ["FullName", "Company", "Position", "City", "Notes", "Email"];
const AR_PATHS = ["FullName", "Company", "Position", "City", "Notes"].map((value) => ({
  value,
  multi: "ar",
}));

/** The scope inside Atlas Search: `compound.filter`, in $search and $searchMeta alike. */
function searchScope(scope: Scope): Document[] {
  return scope.kind === "all"
    ? []
    : [{ equals: { path: "DepartmentId", value: scope.departmentId } }];
}

function quickCompound(scope: Scope, q: string): Document {
  const fuzzyAuto = { maxEdits: 1, prefixLength: 1 };
  const autocomplete = (path: string, boost: number, fuzzy?: Document) => ({
    autocomplete: {
      query: q,
      path,
      ...(fuzzy ? { fuzzy } : {}),
      score: { boost: { value: boost } },
    },
  });
  return {
    should: [
      autocomplete("FullName", 6),
      autocomplete("Company", 4),
      autocomplete("FullName", 4, fuzzyAuto),
      autocomplete("Company", 3, fuzzyAuto),
      autocomplete("Position", 2, fuzzyAuto),
      {
        text: {
          query: q,
          path: TEXT_PATHS,
          fuzzy: { maxEdits: q.length >= 5 ? 2 : 1, prefixLength: 1 },
          score: { boost: { value: 2 } },
        },
      },
      { text: { query: q, path: AR_PATHS } },
    ],
    minimumShouldMatch: 1,
    filter: searchScope(scope),
  };
}

/** Quick search while typing: by mobile, by email, or by text (Atlas Search). No AI. */
export async function quickSearch(
  scope: Scope,
  query: string,
  limit = 20,
): Promise<{ items: Contact[]; total: number }> {
  const { contacts } = collections();
  const q = normalizeDigits(query).trim();
  if (q.length < 2) return { items: [], total: 0 };

  const byKey = async (filter: Filter<ContactDoc>) => {
    const scoped: Filter<ContactDoc> = { $and: [scopeFilter(scope), filter] };
    const [docs, total] = await Promise.all([
      contacts.find(scoped).sort({ CreatedAt: -1, _id: -1 }).limit(limit).toArray(),
      contacts.countDocuments(scoped),
    ]);
    return { items: docs.map(toContact), total };
  };

  const digits = q.replace(/\D/g, "");
  if (/^[+\d\s\-().]+$/.test(q) && digits.length >= 3) {
    const pattern = digits.replace(/^(00964|964|0)/, "") || digits;
    return byKey({ _mobiles: { $regex: escapeRegex(pattern) } });
  }
  if (q.includes("@")) {
    return byKey({ _emails: { $regex: escapeRegex(q.toLowerCase()) } });
  }

  const compound = quickCompound(scope, q);
  const [docs, meta] = await Promise.all([
    contacts
      .aggregate<ContactDoc>([{ $search: { index: SEARCH_INDEX, compound } }, { $limit: limit }])
      .toArray(),
    contacts
      .aggregate<{ count?: { total?: number } }>([
        { $searchMeta: { index: SEARCH_INDEX, compound, count: { type: "total" } } },
      ])
      .toArray(),
  ]);
  return { items: docs.map(toContact), total: meta[0]?.count?.total ?? docs.length };
}

/** Ask AI's search: every given field must match; the scope is fixed by the caller. */
export async function searchContacts(scope: Scope, params: SearchParams): Promise<Contact[]> {
  const { contacts } = collections();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 20);

  const fuzzy = (query: string) => ({ maxEdits: query.length >= 5 ? 2 : 1, prefixLength: 1 });
  const either = (query: string, paths: string[], arPaths: Document[]) => ({
    compound: {
      should: [
        { text: { query, path: paths, fuzzy: fuzzy(query) } },
        ...(arPaths.length ? [{ text: { query, path: arPaths } }] : []),
      ],
      minimumShouldMatch: 1,
    },
  });

  const must: Document[] = [];
  for (const field of ["FullName", "Position", "Company", "City"] as const) {
    const value = params[field]?.trim();
    if (value) must.push(either(value, [field], [{ value: field, multi: "ar" }]));
  }
  const text = params.text?.trim();
  if (text) must.push(either(text, [...TEXT_PATHS, "Sector"], AR_PATHS));

  const range = dateRange(params.dateFrom, params.dateTo);

  if (must.length === 0) {
    // Nothing to match by text: the newest contacts within the filters.
    const and: Filter<ContactDoc>[] = [scopeFilter(scope)];
    if (params.Sector) and.push({ Sector: params.Sector });
    if (range) and.push({ CreatedAt: range });
    const docs = await contacts
      .find({ $and: and })
      .sort({ CreatedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return docs.map(toContact);
  }

  const filter = searchScope(scope);
  if (params.Sector) filter.push({ equals: { path: "Sector", value: params.Sector } });
  if (range) {
    filter.push({
      range: {
        path: "CreatedAt",
        ...(range.$gte ? { gte: range.$gte } : {}),
        ...(range.$lt ? { lt: range.$lt } : {}),
      },
    });
  }
  const docs = await contacts
    .aggregate<ContactDoc>([
      { $search: { index: SEARCH_INDEX, compound: { must, filter } } },
      { $limit: limit },
    ])
    .toArray();
  return docs.map(toContact);
}

async function findDoc(scope: Scope, id: string): Promise<ContactDoc> {
  const _id = toObjectId(id);
  // Outside the scope = not found: the contact's existence is not revealed.
  const doc = _id
    ? await collections().contacts.findOne({ $and: [scopeFilter(scope), { _id }] })
    : null;
  if (!doc) throw new AppError("NOT_FOUND", NOT_FOUND);
  return doc;
}

export async function getContact(scope: Scope, id: string): Promise<Contact> {
  return toContact(await findDoc(scope, id));
}

/** Keeps the order of `ids`; drops invalid, unknown and out-of-scope ids. */
export async function getContactsByIds(scope: Scope, ids: string[]): Promise<Contact[]> {
  const objectIds = ids.map(toObjectId).filter((id): id is ObjectId => id !== null);
  if (objectIds.length === 0) return [];
  const docs = await collections()
    .contacts.find({ $and: [scopeFilter(scope), { _id: { $in: objectIds } }] })
    .toArray();
  const byId = new Map(docs.map((doc) => [doc._id.toHexString(), doc]));
  const seen = new Set<string>();
  const ordered: Contact[] = [];
  for (const id of objectIds) {
    const key = id.toHexString();
    const doc = byId.get(key);
    if (doc && !seen.has(key)) {
      seen.add(key);
      ordered.push(toContact(doc));
    }
  }
  return ordered;
}

/** Distinct non-empty values with counts, most used first. */
export async function listValues(
  scope: Scope,
  field: "Company" | "City" | "Sector",
  max = 1000,
): Promise<{ value: string; count: number }[]> {
  const rows = await collections()
    .contacts.aggregate<{ _id: string; count: number }>([
      { $match: { $and: [scopeFilter(scope), { [field]: { $nin: ["", null] } }] } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: max },
    ])
    .toArray();
  return rows.map((row) => ({ value: row._id, count: row.count }));
}

/** The users who added contacts in scope. Contacts added by scripts are not listed. */
export async function listCreators(
  scope: Scope,
): Promise<{ id: string; name: string; username: string; count: number }[]> {
  const { contacts, users } = collections();
  const rows = await contacts
    .aggregate<{ _id: ObjectId; count: number }>([
      { $match: { $and: [scopeFilter(scope), { CreatedBy: { $ne: null } }] } },
      { $group: { _id: "$CreatedBy", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
  if (rows.length === 0) return [];
  const people = await users
    .find({ _id: { $in: rows.map((row) => row._id) } }, { projection: { name: 1, username: 1 } })
    .toArray();
  const byId = new Map(people.map((person) => [person._id.toHexString(), person]));
  return rows.flatMap((row) => {
    const person = byId.get(row._id.toHexString());
    return person
      ? [
          {
            id: row._id.toHexString(),
            name: person.name,
            username: person.username,
            count: row.count,
          },
        ]
      : [];
  });
}

/**
 * Marks contacts that share a mobile or email with a saved contact IN THE SAME
 * DEPARTMENT, or with an earlier contact of the batch.
 */
export async function findDuplicates(
  departmentId: ObjectId,
  batch: ContactInput[],
): Promise<ReviewContact[]> {
  const keys = batch.map((contact) => toMatchKeys(contact));
  const mobiles = [...new Set(keys.flatMap((key) => key._mobiles))];
  const emails = [...new Set(keys.flatMap((key) => key._emails))];

  const or: Filter<ContactDoc>[] = [];
  if (mobiles.length) or.push({ _mobiles: { $in: mobiles } });
  if (emails.length) or.push({ _emails: { $in: emails } });
  const saved = or.length
    ? await collections()
        .contacts.find(
          { DepartmentId: departmentId, $or: or },
          { projection: { FullName: 1, Company: 1, _mobiles: 1, _emails: 1 } },
        )
        .sort({ CreatedAt: -1 })
        .toArray()
    : [];

  const shares = (
    a: { _mobiles: string[]; _emails: string[] },
    b: { _mobiles: string[]; _emails: string[] },
  ) =>
    a._mobiles.some((mobile) => b._mobiles.includes(mobile)) ||
    a._emails.some((email) => b._emails.includes(email));

  return batch.map((contact, index) => {
    const review: ReviewContact = { ...contact };
    const key = keys[index];
    if (key._mobiles.length === 0 && key._emails.length === 0) return review;
    const match = saved.find((doc) => shares(key, doc));
    if (match) {
      review.duplicateOfId = match._id.toHexString();
      review.duplicateOfName = match.FullName || match.Company || "a saved contact";
    }
    const earlier = keys.findIndex((other, at) => at < index && shares(key, other));
    if (earlier >= 0) review.duplicateInBatch = earlier;
    return review;
  });
}

// ---------- Writes ----------

function refuseInvalidEmail(email: string | undefined): void {
  const invalid = invalidEmails(email ?? "");
  if (invalid.length > 0) {
    throw new AppError(
      "VALIDATION",
      `Not a valid email: ${invalid[0]}. Fix it or clear the field.`,
    );
  }
}

export async function insertContacts(
  writer: Writer,
  inputs: ContactInput[],
  source: Source,
): Promise<Contact[]> {
  if (inputs.length === 0) return [];
  for (const input of inputs) refuseInvalidEmail(input.Email);
  const now = new Date();
  const docs: ContactDoc[] = inputs.map((input) => {
    const clean = cleanContact(input);
    return {
      _id: new ObjectId(),
      ...clean,
      Source: source,
      DepartmentId: writer.departmentId,
      CreatedBy: writer.actor.userId,
      UpdatedBy: writer.actor.userId,
      ...toMatchKeys(clean),
      CreatedAt: now,
      UpdatedAt: now,
    };
  });
  await collections().contacts.insertMany(docs);
  await writeAudit(
    docs.map((doc) => ({
      userId: writer.actor.userId,
      username: writer.actor.username,
      action: "create" as const,
      contactId: doc._id,
      contactName: contactName(doc),
      departmentId: doc.DepartmentId,
    })),
  );
  return docs.map(toContact);
}

function beforeOf(doc: ContactDoc): Record<string, unknown> {
  const { _mobiles, _emails, ...rest } = doc;
  void _mobiles;
  void _emails;
  return rest;
}

/** Edits within the writer's scope. Editing never moves a contact to another department. */
export async function updateContact(
  writer: Writer,
  id: string,
  patch: ContactPatch,
): Promise<Contact> {
  refuseInvalidEmail(patch.Email);
  const existing = await findDoc(writer.scope, id);
  const clean = cleanContact({ ...fieldsOf(existing), ...patch });
  const set = {
    ...clean,
    ...toMatchKeys(clean),
    UpdatedBy: writer.actor.userId,
    UpdatedAt: new Date(),
  };
  await collections().contacts.updateOne({ _id: existing._id }, { $set: set });
  await writeAudit([
    {
      userId: writer.actor.userId,
      username: writer.actor.username,
      action: "update",
      contactId: existing._id,
      contactName: contactName(clean),
      departmentId: existing.DepartmentId ?? null,
      before: beforeOf(existing),
    },
  ]);
  return toContact({ ...existing, ...set });
}

export async function deleteContact(writer: Writer, id: string): Promise<{ deleted: string }> {
  const existing = await findDoc(writer.scope, id);
  await collections().contacts.deleteOne({ _id: existing._id });
  await writeAudit([
    {
      userId: writer.actor.userId,
      username: writer.actor.username,
      action: "delete",
      contactId: existing._id,
      contactName: contactName(existing),
      departmentId: existing.DepartmentId ?? null,
      before: beforeOf(existing),
    },
  ]);
  return { deleted: existing._id.toHexString() };
}

/**
 * Empties the contacts collection. Only for `seed --reset` and `eval:search`: it
 * refuses unless the database name contains "test" or is EVAL_DB. No route calls it.
 */
export async function deleteAllContacts(): Promise<number> {
  const name = currentDatabaseName();
  if (!name.includes("test") && name !== config().EVAL_DB) {
    throw new AppError(
      "FORBIDDEN",
      `Refusing to delete all contacts in "${name}": the database name must contain "test" or be EVAL_DB.`,
    );
  }
  const result = await collections().contacts.deleteMany({});
  return result.deletedCount;
}
