"use client";

import { useState } from "react";
import { Smartphone, Trash2, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { splitBilingual } from "@/lib/bilingual";
import { formatDateTime } from "@/lib/dates";
import { useUnsaved } from "@/lib/unsaved";
import {
  type Contact,
  type ContactInput,
  emptyContact,
  FIELDS,
  type Field,
} from "@/modules/contacts/contact.schema";
import { invalidEmails } from "@/modules/contacts/normalize";
import { ContactFields } from "./ContactFields";
import { useMe } from "./MeProvider";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Spinner } from "./ui/spinner";

function fieldsOf(contact: Contact | null): ContactInput {
  const values = emptyContact();
  if (!contact) return values;
  return { ...values, ...Object.fromEntries(FIELDS.map((field) => [field, contact[field]])) };
}

type Props = {
  /** The contact to show; `null` keeps the dialog closed. Give the form `key={contact?.id}`. */
  contact: Contact | null;
  onClose: () => void;
  onSaved: (contact: Contact) => void;
  onDeleted: (id: string) => void;
};

/** The contact dialog: view, edit, delete, and "Add to phone contacts". */
export function ContactForm({ contact, onClose, onSaved, onDeleted }: Props) {
  const me = useMe();
  const [draft, setDraft] = useState<ContactInput>(() => fieldsOf(contact));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState("");

  const canEdit = me.can.edit;
  const changed = contact ? FIELDS.filter((field) => draft[field] !== contact[field]) : [];
  const dirty = canEdit && changed.length > 0;
  const emailInvalid = invalidEmails(draft.Email).length > 0;

  useUnsaved("contact-dialog", dirty);

  // Esc, the backdrop and the close button all come here.
  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm("Close without saving your changes?")) return;
    onClose();
  };

  const setField = (field: Field, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }) as ContactInput);
    setError("");
  };

  const save = async () => {
    if (!contact || !dirty || emailInvalid || busy) return;
    setBusy("save");
    setError("");
    try {
      const patch = Object.fromEntries(changed.map((field) => [field, draft[field]]));
      onSaved(await api<Contact>(`/api/contacts/${contact.id}`, { method: "PATCH", body: patch }));
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!contact || busy) return;
    if (!window.confirm("Delete this contact?")) return;
    setBusy("delete");
    setError("");
    try {
      await api(`/api/contacts/${contact.id}`, { method: "DELETE" });
      onDeleted(contact.id);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(null);
    }
  };

  const title = contact ? contact.FullName || contact.Company || "Contact" : "Contact";

  return (
    <Dialog
      open={contact !== null}
      onClose={requestClose}
      label={canEdit ? "Edit contact" : "Contact"}
      className="w-[42rem] max-w-[calc(100vw-1.5rem)] overflow-hidden"
    >
      {contact ? (
        // The header and the buttons stay in view; the fields scroll between them.
        <form
          className="flex max-h-[90dvh] flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <header className="flex shrink-0 items-start gap-3 border-b border-zinc-200 py-2 ps-4 pe-2">
            <div className="min-w-0 flex-1 py-1.5">
              <h2 className="text-base font-semibold text-zinc-900 wrap-anywhere">
                {splitBilingual(title).map((line, index) => (
                  <span key={index} dir="auto" className="block text-left">
                    {line}
                  </span>
                ))}
              </h2>
              {canEdit ? null : (
                <Badge tone="amber" className="mt-1">
                  View only
                </Badge>
              )}
            </div>
            <button
              type="button"
              aria-label="Close"
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              onClick={requestClose}
            >
              <X aria-hidden className="size-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <ContactFields
              idPrefix="contact-dialog"
              value={draft}
              onChange={setField}
              readOnly={!canEdit}
            />
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
              <div className="flex gap-1">
                <dt>Added</dt>
                <dd className="text-zinc-700">{formatDateTime(contact.CreatedAt, me.timeZone)}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Updated</dt>
                <dd className="text-zinc-700">{formatDateTime(contact.UpdatedAt, me.timeZone)}</dd>
              </div>
            </dl>
          </div>

          <footer className="shrink-0 border-t border-zinc-200 px-4 py-3">
            {error ? (
              <p role="alert" className="mb-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {me.can.delete ? (
                <Button variant="danger" disabled={busy !== null} onClick={remove}>
                  {busy === "delete" ? <Spinner /> : <Trash2 aria-hidden className="size-4" />}
                  Delete
                </Button>
              ) : null}
              {/* A plain link: the phone opens the .vcf in its contacts app. */}
              <a
                href={`/api/contacts/${contact.id}/vcard`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                <Smartphone aria-hidden className="size-4" />
                Add to phone contacts
              </a>
              {canEdit ? (
                <div className="ms-auto flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    disabled={!dirty || busy !== null}
                    onClick={() => {
                      setDraft(fieldsOf(contact));
                      setError("");
                    }}
                  >
                    Reset
                  </Button>
                  <Button type="submit" disabled={!dirty || emailInvalid || busy !== null}>
                    {busy === "save" ? <Spinner /> : null}
                    Save changes
                  </Button>
                </div>
              ) : null}
            </div>
          </footer>
        </form>
      ) : null}
    </Dialog>
  );
}
