"use client";

import { memo, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { initials, splitBilingual } from "@/lib/bilingual";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { type Contact, type SORT_FIELDS, splitMulti } from "@/modules/contacts/contact.schema";
import { Button } from "./ui/button";
import { Label, Select } from "./ui/input";

export type SortField = (typeof SORT_FIELDS)[number];
export type Sort = { field: SortField; dir: "asc" | "desc" };

// The layout follows the width of the list's own space (container "list"):
// under 52rem cards, 52–68rem a table without City and Added, 68rem and up the full table.
// One table in the DOM: under 52rem its parts are shown as blocks, so each row is a card.

/** Hidden in the middle layout only. */
const WIDE_ONLY = "@[52rem]/list:hidden @[68rem]/list:table-cell";

const COLUMNS: { field: SortField; label: string; className: string }[] = [
  { field: "FullName", label: "Name", className: "w-[17%]" },
  { field: "Position", label: "Position", className: "w-[11%]" },
  { field: "Company", label: "Company", className: "w-[14%]" },
  { field: "City", label: "City", className: cn("w-[9%]", WIDE_ONLY) },
  { field: "Mobile", label: "Mobile", className: "w-[13%]" },
  { field: "Email", label: "Email", className: "w-[16%]" },
  { field: "Sector", label: "Sector", className: "w-[11%]" },
  { field: "CreatedAt", label: "Added", className: cn("w-[9%]", WIDE_ONLY) },
];

const CELL =
  "block px-3 py-0.5 text-sm text-zinc-700 wrap-anywhere " +
  "@max-[52rem]/list:ps-14 @max-[52rem]/list:empty:hidden " +
  "@[52rem]/list:table-cell @[52rem]/list:px-2 @[52rem]/list:py-2.5 @[52rem]/list:align-top";

function nextSort(current: Sort, field: SortField): Sort {
  if (current.field === field) return { field, dir: current.dir === "asc" ? "desc" : "asc" };
  return { field, dir: field === "CreatedAt" ? "desc" : "asc" };
}

/** One line per value. Values may be Arabic: the direction is per line, the alignment is not. */
function Lines({ values, className }: { values: string[]; className?: string }) {
  return values.map((value, index) => (
    <span key={index} dir="auto" className={cn("block text-left", className)}>
      {value}
    </span>
  ));
}

const bilingual = (value: string) => (value ? splitBilingual(value) : []);

type Props = {
  contacts: Contact[];
  timeZone: string;
  onOpen: (contact: Contact) => void;
  /** With both, the headers sort and the cards get a "Sort by" select. */
  sort?: Sort;
  onSort?: (sort: Sort) => void;
  /** High Management: department id → name, shown under the sector. */
  departmentNames?: Map<string, string>;
  /** A newer list is loading: the old one stays visible, dimmed. */
  stale?: boolean;
};

function ContactTableInner({
  contacts,
  timeZone,
  onOpen,
  sort,
  onSort,
  departmentNames,
  stale,
}: Props) {
  const sortable = sort && onSort ? { sort, onSort } : null;

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, contact: Contact) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen(contact);
  };

  const onRowClick = (contact: Contact) => {
    // Selecting a phone or an email to copy it is not a click on the row.
    if (window.getSelection()?.toString()) return;
    onOpen(contact);
  };

  return (
    <div
      className={cn("contact-list @container/list", stale && "opacity-60")}
      aria-busy={stale || undefined}
    >
      {sortable ? (
        <div className="mb-3 flex items-end gap-2 @[52rem]/list:hidden">
          <div className="min-w-0 flex-1">
            <Label htmlFor="contact-sort">Sort by</Label>
            <Select
              id="contact-sort"
              value={sortable.sort.field}
              onChange={(event) =>
                sortable.onSort(nextSort(sortable.sort, event.target.value as SortField))
              }
            >
              {COLUMNS.map((column) => (
                <option key={column.field} value={column.field}>
                  {column.label}
                </option>
              ))}
            </Select>
          </div>
          <Button
            variant="outline"
            aria-label={
              sortable.sort.dir === "asc"
                ? "Ascending order. Switch to descending"
                : "Descending order. Switch to ascending"
            }
            onClick={() => sortable.onSort(nextSort(sortable.sort, sortable.sort.field))}
          >
            {sortable.sort.dir === "asc" ? (
              <ArrowUp aria-hidden className="size-4" />
            ) : (
              <ArrowDown aria-hidden className="size-4" />
            )}
          </Button>
        </div>
      ) : null}

      <div className="@[52rem]/list:overflow-hidden @[52rem]/list:rounded-lg @[52rem]/list:border @[52rem]/list:border-zinc-200">
        <table className="block w-full table-fixed border-collapse text-left @[52rem]/list:table">
          <thead className="hidden bg-zinc-50 @[52rem]/list:table-header-group">
            <tr>
              {COLUMNS.map((column) => {
                const active = sortable?.sort.field === column.field;
                return (
                  <th
                    key={column.field}
                    scope="col"
                    aria-sort={
                      active
                        ? sortable.sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "border-b border-zinc-200 text-xs font-semibold text-zinc-600",
                      column.className,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-1 px-2 text-left hover:text-zinc-900"
                        onClick={() => sortable.onSort(nextSort(sortable.sort, column.field))}
                      >
                        <span>{column.label}</span>
                        {active ? (
                          sortable.sort.dir === "asc" ? (
                            <ArrowUp aria-hidden className="size-3.5 shrink-0 text-primary" />
                          ) : (
                            <ArrowDown aria-hidden className="size-3.5 shrink-0 text-primary" />
                          )
                        ) : (
                          <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-zinc-300" />
                        )}
                      </button>
                    ) : (
                      <span className="flex min-h-11 items-center px-2">{column.label}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="block @[52rem]/list:table-row-group">
            {contacts.map((contact) => {
              const department = departmentNames
                ? contact.DepartmentId
                  ? (departmentNames.get(contact.DepartmentId) ?? "")
                  : "No department"
                : "";
              const city = bilingual(contact.City);
              return (
                <tr
                  key={contact.id}
                  tabIndex={0}
                  aria-haspopup="dialog"
                  onClick={() => onRowClick(contact)}
                  onKeyDown={(event) => onRowKey(event, contact)}
                  className={cn(
                    "block cursor-pointer bg-white -outline-offset-2 hover:bg-zinc-50",
                    "@max-[52rem]/list:mb-2 @max-[52rem]/list:rounded-lg @max-[52rem]/list:border",
                    "@max-[52rem]/list:border-zinc-200 @max-[52rem]/list:py-2.5",
                    "@[52rem]/list:table-row @[52rem]/list:border-b @[52rem]/list:border-zinc-100",
                    "@[52rem]/list:last:border-b-0",
                  )}
                >
                  <td className="block px-3 pb-0.5 text-sm wrap-anywhere @[52rem]/list:table-cell @[52rem]/list:px-2 @[52rem]/list:py-2.5 @[52rem]/list:align-top">
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      >
                        {initials(contact.FullName, contact.Company)}
                      </span>
                      <span className="min-w-0 flex-1 font-medium text-zinc-900">
                        {contact.FullName ? (
                          <Lines values={splitBilingual(contact.FullName)} />
                        ) : (
                          <span className="font-normal text-zinc-400">No name</span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className={CELL}>
                    <Lines values={bilingual(contact.Position)} />
                  </td>
                  <td className={CELL}>
                    <Lines values={bilingual(contact.Company)} />
                    {city.length > 0 ? (
                      <span className="hidden text-xs text-zinc-500 @[52rem]/list:block @[68rem]/list:hidden">
                        <Lines values={city} />
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(CELL, WIDE_ONLY)}>
                    <Lines values={city} />
                  </td>
                  <td className={CELL}>
                    <Lines values={splitMulti(contact.Mobile)} />
                  </td>
                  <td className={CELL}>
                    <Lines values={splitMulti(contact.Email)} />
                  </td>
                  <td className={cn(CELL, "@max-[52rem]/list:pt-1.5")}>
                    <span className="block text-xs text-zinc-600 @[52rem]/list:text-sm">
                      {contact.Sector}
                    </span>
                    {department ? (
                      <span dir="auto" className="block text-left text-xs text-zinc-500">
                        {department}
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(CELL, WIDE_ONLY, "@max-[52rem]/list:text-xs")}>
                    <span className="text-zinc-500 @[52rem]/list:hidden">Added </span>
                    <span className="text-zinc-500 @[52rem]/list:text-zinc-700">
                      {formatDate(contact.CreatedAt, timeZone)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The contact list. Memoized: typing in the search box does not redraw the rows. */
export const ContactTable = memo(ContactTableInner);
