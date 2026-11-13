import { z } from "zod";
import { config } from "@/lib/config";
import { dayInZone } from "@/lib/dates";
import type { Scope } from "@/modules/accounts/scope";
import { defineTool, type FinalTool, type LoopTool } from "@/modules/ai/tool-loop";
import { SECTORS, VALUE_FIELDS } from "@/modules/contacts/contact.schema";
import { listValues, searchContacts } from "@/modules/contacts/contacts.repo";

// What the model may call during Ask AI (docs/tools.md §6). It can only READ, and only
// inside `scope`, which is fixed here on the server: it is never a tool input, so
// neither the model nor a question can widen it.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// Every field stays optional: the model sends only the fields it needs.
const SearchInput = z.object({
  text: z
    .string()
    .optional()
    .describe(
      "Free text matched against all fields (names, companies, positions, cities, notes, email).",
    ),
  FullName: z.string().optional().describe("Person name or part of it (fuzzy)."),
  Position: z.string().optional().describe("Job title words (fuzzy)."),
  Company: z.string().optional().describe("Organization name or part of it (fuzzy)."),
  City: z.string().optional().describe("City name (fuzzy)."),
  Sector: z.enum(SECTORS).optional().describe("Exact sector."),
  dateFrom: day.optional().describe("Added on or after this date (YYYY-MM-DD)."),
  dateTo: day.optional().describe("Added on or before this date (YYYY-MM-DD)."),
  limit: z.number().int().optional(),
});

/** Small models send "" or null for fields they do not use: treat those as absent. */
function dropEmpty(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== "" && value !== null),
  );
}

export function searchTools(scope: Scope): LoopTool[] {
  const zone = config().APP_TIME_ZONE;
  return [
    defineTool({
      name: "search_contacts",
      description:
        "Search the contacts database. Every given field must match (fuzzy, typo-tolerant); `text` matches any field. Returns up to 20 contacts with their id. Arabic and English values are stored as written, so search both spellings when a name could be written either way.",
      schema: z.preprocess(dropEmpty, SearchInput),
      run: async (input) => {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 20);
        const found = await searchContacts(scope, { ...input, limit });
        return {
          count: found.length,
          results: found.map((contact) => ({
            id: contact.id,
            FullName: contact.FullName,
            Position: contact.Position,
            Company: contact.Company,
            City: contact.City,
            Sector: contact.Sector,
            Email: contact.Email,
            Mobile: contact.Mobile,
            Added: dayInZone(new Date(contact.CreatedAt), zone),
          })),
        };
      },
    }),
    defineTool({
      name: "list_values",
      description:
        "List the distinct values stored for Company, City or Sector, with how many contacts have each. Use it to find the exact stored spelling before searching.",
      schema: z.object({ field: z.enum(VALUE_FIELDS) }),
      run: async ({ field }) => {
        const values = await listValues(scope, field, 150);
        return { field, values: values.map((row) => `${row.value} (${row.count})`) };
      },
    }),
  ];
}

export const FinalAnswer = z.object({
  answer: z
    .string()
    .describe("One short sentence answering the question, in the question's language."),
  contactIds: z
    .array(z.string())
    .describe("Ids of matching contacts, best match first. Empty if none."),
});

export const finalAnswerTool: FinalTool<typeof FinalAnswer> = {
  name: "final_answer",
  description:
    "Give the final answer and the ids of the matching contacts (best first). Always end with this.",
  schema: FinalAnswer,
};
