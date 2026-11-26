"use client";

import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { useMe } from "@/components/MeProvider";
import { PageHeader } from "@/components/PageHeader";
import { ReviewTable, useReviewList } from "@/components/ReviewTable";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Spinner, StateMessage } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api";
import type { ReviewContact } from "@/modules/contacts/contact.schema";

const TIPS = [
  "Paste email signatures, WhatsApp messages or notes.",
  "Several contacts at once are fine.",
  "Arabic and English both work.",
  "The AI only suggests: you review and save.",
  "Use test data only until the office decides about privacy.",
];

export default function Page() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Add from Text">
        Paste any text with contact details and let the AI sort it into fields.
      </PageHeader>
      {me.can.add ? (
        <AddFromText />
      ) : (
        <StateMessage kind="empty">Your role can only view contacts.</StateMessage>
      )}
    </>
  );
}

function AddFromText() {
  const review = useReviewList("add-text", "text");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nothingFound, setNothingFound] = useState(false);

  async function structure() {
    if (loading || !text.trim()) return;
    // A new run replaces the list: ask before the contacts under review are lost.
    if (!review.confirmDiscard()) return;
    setLoading(true);
    setError("");
    setNothingFound(false);
    try {
      const data = await api<{ contacts: ReviewContact[] }>("/api/extract/text", {
        method: "POST",
        body: { text },
      });
      review.show(data.contacts);
      setNothingFound(data.contacts.length === 0);
    } catch (cause) {
      // The text and any list under review stay as they are.
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <Label htmlFor="add-text-input">Text with contact details</Label>
          <Textarea
            id="add-text-input"
            dir="auto"
            rows={12}
            className="min-h-64"
            placeholder="Paste the text here…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={structure} disabled={loading || !text.trim() || review.saving}>
              {loading ? <Spinner /> : <Sparkles aria-hidden className="size-4" />}
              {loading ? "Structuring…" : "Structure with AI"}
            </Button>
            <Button variant="outline" onClick={review.addManual} disabled={review.saving}>
              <Plus aria-hidden className="size-4" />
              Add manually
            </Button>
          </div>
          <div aria-live="polite" className="mt-3 empty:hidden">
            {error ? (
              <p
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </p>
            ) : nothingFound ? (
              <StateMessage kind="empty">
                The AI found no contacts in this text. You can add one manually.
              </StateMessage>
            ) : null}
          </div>
        </div>

        <aside
          aria-label="Tips"
          className="self-start rounded-lg border border-zinc-200 bg-zinc-50 p-4"
        >
          <h2 className="mb-2 text-sm font-semibold text-zinc-900">Tips</h2>
          <ul className="list-disc space-y-1.5 ps-5 text-sm text-zinc-600">
            {TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </aside>
      </div>

      <ReviewTable {...review.table} />
    </div>
  );
}
