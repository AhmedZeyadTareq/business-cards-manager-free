"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useUnsaved } from "@/lib/unsaved";
import { cn } from "@/lib/utils";
import {
  emptyContact,
  FIELDS,
  type ContactInput,
  type Field,
  type ReviewContact,
} from "@/modules/contacts/contact.schema";
import { cleanForReview, invalidEmails, isEmptyContact } from "@/modules/contacts/normalize";
import { ContactFields } from "./ContactFields";
import { useToast } from "./Toast";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

// The review list shared by Add from Text and Add from Photo (plan §2.6).

export type ReviewRow = {
  /** Stable for the life of the row, so removing a row never renumbers the others' inputs. */
  key: string;
  contact: ContactInput;
  /** "ai" rows save with the page's source, "manual" rows with `source: "manual"`. */
  origin: "ai" | "manual";
  /** Same mobile or email as a contact already saved in this department. */
  duplicateOfName?: string;
  /** Same mobile or email as an earlier row of this list. */
  duplicateOfKey?: string;
  /** Only meaningful for duplicates: true = Skip, false = Save anyway. */
  skip: boolean;
};

export type AiSource = "text" | "photo";

const DISCARD_QUESTION = "You have contacts that are not saved yet. Discard them?";
const MAX_PER_REQUEST = 200; // SaveContactsBody allows 200 contacts per call.

// Only called from event handlers and async callbacks, never during render.
let lastKey = 0;
function newKey(): string {
  lastKey += 1;
  return `r${lastKey}`;
}

export function emptyRow(): ReviewRow {
  return { key: newKey(), contact: emptyContact(), origin: "manual", skip: false };
}

/** AI suggestions → rows. Duplicates start on Skip. */
export function rowsFromReview(contacts: ReviewContact[]): ReviewRow[] {
  const keys = contacts.map(() => newKey());
  return contacts.map((suggested, index) => {
    const contact = emptyContact();
    for (const field of FIELDS) {
      if (field === "Sector") contact.Sector = suggested.Sector;
      else contact[field] = suggested[field] ?? "";
    }
    const earlier = suggested.duplicateInBatch;
    const duplicateOfKey =
      earlier !== undefined && earlier >= 0 && earlier < index ? keys[earlier] : undefined;
    const duplicateOfName = suggested.duplicateOfName || undefined;
    return {
      key: keys[index],
      contact,
      origin: "ai" as const,
      duplicateOfName,
      duplicateOfKey,
      skip: Boolean(duplicateOfName || duplicateOfKey),
    };
  });
}

function isEmptyRow(row: ReviewRow): boolean {
  return isEmptyContact(cleanForReview(row.contact));
}

/** The duplicate badge of a row, or "" when it is not (or no longer) a duplicate. */
function duplicateLabel(row: ReviewRow, rows: ReviewRow[]): string {
  if (row.duplicateOfName) return `Already saved: ${row.duplicateOfName}`;
  if (!row.duplicateOfKey) return "";
  // The row it matched may have been removed: then the mark no longer applies.
  const position = rows.findIndex((other) => other.key === row.duplicateOfKey);
  return position === -1 ? "" : `Same as contact ${position + 1} above`;
}

/** Rows that a save would send: not empty, and not a duplicate left on Skip. */
export function rowsToSave(rows: ReviewRow[]): ReviewRow[] {
  return rows.filter((row) => !isEmptyRow(row) && !(row.skip && duplicateLabel(row, rows)));
}

function plural(count: number): string {
  return count === 1 ? "1 contact" : `${count} contacts`;
}

function listNumbers(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** Why the save is blocked, or "" when it can go ahead. */
function blockedReason(rows: ReviewRow[], sending: ReviewRow[]): string {
  const bad = sending
    .filter((row) => invalidEmails(row.contact.Email).length > 0)
    .map((row) => rows.indexOf(row) + 1);
  if (bad.length > 0) {
    return `Fix the invalid email in ${bad.length === 1 ? "contact" : "contacts"} ${listNumbers(bad)}.`;
  }
  if (sending.length === 0) {
    return rows.every(isEmptyRow)
      ? "Fill in at least one field to save."
      : "Nothing to save: every contact is skipped or empty.";
  }
  return "";
}

function displayName(contact: ContactInput): string {
  return contact.FullName.trim() || contact.Company.trim() || "a contact saved just now";
}

/**
 * Saves the rows that should be saved. One request carries one `source`, so AI rows and
 * manually added rows go in separate requests. On an error, `left` holds what is not
 * saved yet (everything except the rows of the requests that succeeded).
 */
export async function saveRows(
  rows: ReviewRow[],
  aiSource: AiSource,
): Promise<{ saved: number; left: ReviewRow[]; error: string }> {
  const sending = rowsToSave(rows);
  const batches: { source: AiSource | "manual"; rows: ReviewRow[] }[] = [];
  for (const origin of ["ai", "manual"] as const) {
    const group = sending.filter((row) => row.origin === origin);
    for (let start = 0; start < group.length; start += MAX_PER_REQUEST) {
      batches.push({
        source: origin === "ai" ? aiSource : "manual",
        rows: group.slice(start, start + MAX_PER_REQUEST),
      });
    }
  }

  const saved = new Map<string, ReviewRow>();
  try {
    for (const batch of batches) {
      await api("/api/contacts", {
        method: "POST",
        body: { source: batch.source, contacts: batch.rows.map((row) => row.contact) },
      });
      for (const row of batch.rows) saved.set(row.key, row);
    }
  } catch (error) {
    const left = rows
      .filter((row) => !saved.has(row.key))
      .map((row) => {
        // Its match is in the database now: keep it marked as a duplicate.
        const match = row.duplicateOfKey ? saved.get(row.duplicateOfKey) : undefined;
        return match
          ? { ...row, duplicateOfKey: undefined, duplicateOfName: displayName(match.contact) }
          : row;
      });
    return { saved: saved.size, left, error: errorMessage(error) };
  }
  return { saved: saved.size, left: [], error: "" };
}

/**
 * The state of one Add page's review list: rows, saving, the unsaved-work guard and
 * scrolling to new content. `name` must differ per page ("add-text", "add-photo").
 */
export function useReviewList(name: string, aiSource: AiSource) {
  const toast = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [jump, setJump] = useState({ tick: 0, id: "", focusId: "" });
  const jumped = useRef(0);
  const listId = `review-${name}`;

  // An empty manual block holds nothing that could be lost.
  const dirty = rows.some((row) => !isEmptyRow(row));
  useUnsaved(name, dirty);

  // Scroll to new content once. (The effect re-runs when the page is shown again after
  // being hidden, hence the tick check.)
  useEffect(() => {
    if (jump.tick === jumped.current) return;
    jumped.current = jump.tick;
    const target = document.getElementById(jump.id);
    if (!target) return;
    if (jump.focusId) document.getElementById(jump.focusId)?.focus({ preventScroll: true });
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }, [jump]);

  /** true = go ahead (nothing to lose, or the person agreed to discard it). */
  function confirmDiscard(): boolean {
    return !dirty || window.confirm(DISCARD_QUESTION);
  }

  /** Replaces the list with AI suggestions and scrolls to it. */
  function show(contacts: ReviewContact[]) {
    setRows(rowsFromReview(contacts));
    setError("");
    setSavedCount(0);
    setJump((current) => ({ tick: current.tick + 1, id: listId, focusId: "" }));
  }

  function clear() {
    setRows([]);
    setError("");
    setSavedCount(0);
  }

  /** Opens the list with one empty block, or adds one to the open list. No AI. */
  function addManual() {
    const row = emptyRow();
    setRows((current) => [...current, row]);
    setSavedCount(0);
    setJump((current) => ({
      tick: current.tick + 1,
      id: `review-${row.key}`,
      focusId: `review-${row.key}-FullName`,
    }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    // Editing is disabled while saving, so `rows` is still the list when this returns.
    const result = await saveRows(rows, aiSource);
    setRows(result.left);
    setError(result.error);
    setSavedCount(result.saved);
    setSaving(false);
    if (result.saved > 0) toast(`Saved ${plural(result.saved)}.`);
  }

  return {
    rows,
    dirty,
    saving,
    confirmDiscard,
    show,
    clear,
    addManual,
    /** Spread into `<ReviewTable />`. */
    table: {
      id: listId,
      rows,
      onChange: setRows,
      onSave: save,
      onAdd: addManual,
      saving,
      error,
      savedCount,
    },
  };
}

type Props = {
  id?: string;
  rows: ReviewRow[];
  onChange: (rows: ReviewRow[]) => void;
  onSave: () => void;
  /** Adds an empty block (shown as "Add another" in the save bar). */
  onAdd?: () => void;
  saving: boolean;
  /** A failed save. */
  error?: string;
  /** Contacts saved by the last save: shows "Saved N contacts." */
  savedCount?: number;
};

export function ReviewTable({
  id,
  rows,
  onChange,
  onSave,
  onAdd,
  saving,
  error,
  savedCount = 0,
}: Props) {
  const sending = rowsToSave(rows);
  const blocked = rows.length > 0 ? blockedReason(rows, sending) : "";
  const skipped = rows.filter((row) => row.skip && duplicateLabel(row, rows)).length;

  function update(key: string, change: Partial<ReviewRow>) {
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function setField(row: ReviewRow, field: Field, value: string) {
    update(row.key, { contact: { ...row.contact, [field]: value } });
  }

  const saved =
    savedCount > 0 ? (
      <p
        role="status"
        className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
      >
        <CheckCircle2 aria-hidden className="size-4 shrink-0" />
        Saved {plural(savedCount)}.
      </p>
    ) : null;

  if (rows.length === 0) {
    return (
      <section id={id} aria-label="Review list" className="scroll-mt-20 empty:hidden">
        {saved}
      </section>
    );
  }

  return (
    <section id={id} aria-label="Review list" className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-zinc-900">Review and save</h2>
        <p className="text-sm text-zinc-600" aria-live="polite">
          {plural(rows.length)} to review
          {skipped > 0 ? ` · ${skipped} skipped` : ""}
        </p>
      </div>

      {saved ? <div className="mb-3">{saved}</div> : null}

      {/* Disabled while saving: the result of the save replaces the list. */}
      <fieldset disabled={saving} className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Contacts to review</legend>
        <ol className="flex flex-col gap-4">
          {rows.map((row, index) => {
            const number = index + 1;
            const duplicate = duplicateLabel(row, rows);
            const isSkipped = Boolean(duplicate) && row.skip;
            return (
              <li
                key={row.key}
                id={`review-${row.key}`}
                className={cn(
                  "scroll-mt-20 rounded-lg border bg-white p-4",
                  duplicate ? "border-amber-300" : "border-zinc-200",
                )}
              >
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="text-sm font-semibold text-zinc-900">Contact {number}</h3>
                  {row.origin === "manual" ? <Badge>Manual</Badge> : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ms-auto text-zinc-600"
                    aria-label={`Remove contact ${number}`}
                    onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    Remove
                  </Button>
                </div>

                {duplicate ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <Badge tone="amber" className="max-w-full rounded-md py-1 text-sm">
                      <span dir="auto" className="min-w-0 break-words">
                        {duplicate}
                      </span>
                    </Badge>
                    <div
                      role="group"
                      aria-label={`Duplicate: contact ${number}`}
                      className="flex overflow-hidden rounded-md border border-zinc-300"
                    >
                      {(
                        [
                          ["Skip", true],
                          ["Save anyway", false],
                        ] as const
                      ).map(([label, skip]) => (
                        <Button
                          key={label}
                          variant={row.skip === skip ? "primary" : "ghost"}
                          size="sm"
                          aria-pressed={row.skip === skip}
                          className={cn("rounded-none", row.skip !== skip && "bg-white")}
                          onClick={() => update(row.key, { skip })}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <ContactFields
                  idPrefix={`review-${row.key}`}
                  value={row.contact}
                  onChange={(field, value) => setField(row, field, value)}
                  className={isSkipped ? "opacity-60" : undefined}
                />
                {isSkipped ? (
                  <p className="mt-2 text-xs text-zinc-600">Skipped: this contact is not saved.</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </fieldset>

      {/* Stays in view at the bottom of the screen while the list is on it. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-zinc-200 bg-white px-4 py-3 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.15)] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {error ? (
          <p role="alert" className="mb-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
          <p
            aria-live="polite"
            className={cn(
              "me-auto min-w-0 text-sm",
              blocked ? "font-medium text-red-700" : "text-zinc-600",
            )}
          >
            {blocked || (skipped > 0 ? `${plural(skipped)} skipped as duplicates.` : "")}
          </p>
          {onAdd ? (
            <Button variant="outline" onClick={onAdd} disabled={saving}>
              <Plus aria-hidden className="size-4" />
              Add another
            </Button>
          ) : null}
          <Button onClick={onSave} disabled={saving || Boolean(blocked) || sending.length === 0}>
            {saving ? "Saving…" : `Save ${plural(sending.length)}`}
          </Button>
        </div>
      </div>
    </section>
  );
}
