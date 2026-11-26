import { z } from "zod";
import { config } from "@/lib/config";
import { dayInZone } from "@/lib/dates";
import type { Access } from "@/modules/accounts/access";
import { listDepartments } from "@/modules/accounts/departments.repo";
import { writeAudit } from "@/modules/audit/audit.repo";
import { ContactFilters, FIELDS, type Contact } from "./contact.schema";
import { getContactsByIds, listAllContacts, quickSearch } from "./contacts.repo";

/** `ids` (Ask AI results) or `q` (quick search), otherwise the table filters. */
export const ExportQuery = ContactFilters.extend({
  ids: z.string().max(60_000).optional(),
  q: z.string().max(200).optional(),
});
export type ExportQuery = z.infer<typeof ExportQuery>;

/** Quoted, with a leading tab for cells Excel would read as a formula or a number. */
function cell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * UTF-8 with BOM and CRLF line ends, so Excel shows Arabic correctly.
 * `departments` (id → name) adds the Department column (High Management only).
 */
export function toCsv(contacts: Contact[], departments?: Map<string, string>): string {
  const header = [...FIELDS, ...(departments ? ["Department"] : []), "Source", "CreatedAt"];
  const rows = contacts.map((contact) => [
    ...FIELDS.map((field) => contact[field]),
    ...(departments ? [departments.get(contact.DepartmentId ?? "") ?? ""] : []),
    contact.Source,
    contact.CreatedAt,
  ]);
  const lines = [header, ...rows].map((row) => row.map((value) => cell(value ?? "")).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

function describeFilters(query: ExportQuery, departments: Map<string, string>): string {
  const parts: string[] = [];
  if (query.Company) parts.push(`Company=${query.Company}`);
  if (query.City) parts.push(`City=${query.City}`);
  if (query.Sector) parts.push(`Sector=${query.Sector}`);
  if (query.DepartmentId) {
    parts.push(`Department=${departments.get(query.DepartmentId) ?? query.DepartmentId}`);
  }
  if (query.CreatedBy) parts.push(`AddedBy=${query.CreatedBy}`);
  if (query.dateFrom) parts.push(`From=${query.dateFrom}`);
  if (query.dateTo) parts.push(`To=${query.dateTo}`);
  return parts.length ? `Table: ${parts.join(", ")}` : "Table: all";
}

/** Builds the CSV for what is on screen, inside the person's scope, and logs the export. */
export async function exportForAccess(
  access: Access,
  query: ExportQuery,
): Promise<{ csv: string; filename: string; count: number }> {
  const all = access.scope.kind === "all";
  const names = new Map<string, string>();
  if (all)
    for (const department of await listDepartments()) names.set(department.id, department.name);

  let contacts: Contact[];
  let detail: string;
  if (query.ids !== undefined) {
    contacts = await getContactsByIds(access.scope, query.ids.split(",").filter(Boolean));
    detail = "AI search results";
  } else if (query.q !== undefined && query.q.trim() !== "") {
    contacts = (await quickSearch(access.scope, query.q, 100_000)).items;
    detail = `Search: ${query.q.trim()}`;
  } else {
    contacts = await listAllContacts(access.scope, query);
    detail = describeFilters(query, names);
  }

  await writeAudit([
    {
      userId: access.actor.userId,
      username: access.actor.username,
      action: "export",
      departmentId: all ? null : access.departmentId,
      count: contacts.length,
      detail,
    },
  ]);

  const day = dayInZone(new Date(), config().APP_TIME_ZONE);
  return {
    csv: toCsv(contacts, all ? names : undefined),
    filename: `contacts-${day}.csv`,
    count: contacts.length,
  };
}
