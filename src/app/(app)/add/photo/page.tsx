"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { Camera, ImageIcon, Plus, ScanText } from "lucide-react";
import { useMe } from "@/components/MeProvider";
import { PageHeader } from "@/components/PageHeader";
import { ReviewTable, useReviewList } from "@/components/ReviewTable";
import { Button } from "@/components/ui/button";
import { Spinner, StateMessage } from "@/components/ui/spinner";
import { api, ApiError, errorMessage } from "@/lib/api";
import { shrinkImage } from "@/lib/shrink-image";
import type { ReviewContact } from "@/modules/contacts/contact.schema";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const TOO_LARGE = "This photo is too large to upload. Export it as JPG and try again.";
const TOUCH = "(pointer: coarse)";

type PhotoResult = { cardCount: number; contacts: ReviewContact[]; warning?: string };

function subscribeTouch(onChange: () => void): () => void {
  const media = window.matchMedia(TOUCH);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** true on phones and tablets, where "Take photo" opens the camera. */
function useTouchDevice(): boolean {
  return useSyncExternalStore(
    subscribeTouch,
    () => window.matchMedia(TOUCH).matches,
    () => false,
  );
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function Page() {
  const me = useMe();
  return (
    <>
      <PageHeader title="Add from Photo">
        Photograph one or several business cards and let the AI read them.
      </PageHeader>
      {me.can.add ? (
        <AddFromPhoto />
      ) : (
        <StateMessage kind="empty">Your role can only view contacts.</StateMessage>
      )}
    </>
  );
}

function AddFromPhoto() {
  const review = useReviewList("add-photo", "photo");
  const touch = useTouchDevice();
  const [file, setFile] = useState<File | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ cardCount: number; warning: string } | null>(null);
  const chooseInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLImageElement>(null);

  // The object URL lives only while the page is shown: it is made again when the page
  // comes back, so the preview never points at a revoked URL.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (preview.current) preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Opens the file picker or the camera, after asking about contacts under review. */
  function pick(input: HTMLInputElement | null) {
    if (loading || !input) return;
    if (!review.confirmDiscard()) return;
    // Discard now: if the browser does not open the picker after a slow answer, the next
    // click must not ask again.
    review.clear();
    setResult(null);
    input.click();
  }

  function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = ""; // so the same file can be chosen again
    if (!picked) return;
    setFile(picked);
    setPreviewFailed(false);
    setError("");
    setResult(null);
  }

  async function extract() {
    if (loading || !file) return;
    if (!review.confirmDiscard()) return;
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      const image = await shrinkImage(file);
      form.append("image", image, image.name);
      const data = await api<PhotoResult>("/api/extract/photo", { method: "POST", form });
      review.show(data.contacts);
      setResult({ cardCount: data.cardCount, warning: data.warning ?? "" });
    } catch (cause) {
      // The chosen photo and any list under review stay as they are.
      setError(cause instanceof ApiError && cause.status === 413 ? TOO_LARGE : errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-4">
        <input
          ref={chooseInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={onPicked}
        />
        <input
          ref={cameraInput}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={onPicked}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={file ? "outline" : "primary"}
            onClick={() => pick(chooseInput.current)}
            disabled={loading}
          >
            <ImageIcon aria-hidden className="size-4" />
            Choose photo
          </Button>
          {touch ? (
            <Button variant="outline" onClick={() => pick(cameraInput.current)} disabled={loading}>
              <Camera aria-hidden className="size-4" />
              Take photo
            </Button>
          ) : null}
          <Button variant="outline" onClick={review.addManual} disabled={review.saving}>
            <Plus aria-hidden className="size-4" />
            Add manually
          </Button>
        </div>

        {file ? (
          <div className="rounded-lg border border-zinc-200 p-3">
            {/* A local object URL: next/image has nothing to optimise here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={preview}
              alt="Chosen photo"
              className={previewFailed ? "hidden" : "mx-auto max-h-80 max-w-full rounded-md"}
              onError={() => setPreviewFailed(true)}
            />
            {previewFailed ? (
              <p className="flex items-center gap-2 text-sm text-zinc-600">
                <ImageIcon aria-hidden className="size-4 shrink-0" />
                This browser cannot preview the photo. It can still be read.
              </p>
            ) : null}
            <p className="mt-2 text-xs break-all text-zinc-600">
              <span dir="auto">{file.name}</span> · {fileSize(file.size)}
            </p>
          </div>
        ) : (
          <StateMessage kind="empty">
            No photo chosen yet. JPG, PNG, WEBP or HEIC; several cards in one photo are fine.
          </StateMessage>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button onClick={extract} disabled={loading || !file || review.saving}>
            {loading ? <Spinner /> : <ScanText aria-hidden className="size-4" />}
            {loading ? "Reading cards…" : "Extract contacts"}
          </Button>
          <p className="text-sm text-zinc-600">Many cards can take up to a minute.</p>
        </div>

        <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
          {error ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </p>
          ) : null}
          {result ? (
            <>
              <p className="text-sm font-semibold text-zinc-900">
                {result.cardCount === 1 ? "1 card found" : `${result.cardCount} cards found`}
              </p>
              {result.warning ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {result.warning}
                </p>
              ) : null}
              {review.rows.length === 0 && review.table.savedCount === 0 ? (
                <StateMessage kind="empty">
                  No contacts were read from this photo. You can add one manually.
                </StateMessage>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <ReviewTable {...review.table} />
    </div>
  );
}
