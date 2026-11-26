"use client";

import { Search, Sparkles, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

/** The longest question Ask AI takes; quick search takes less and says so on the page. */
const MAX_LENGTH = 500;

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Enter in the box: open the first match. */
  onEnter: () => void;
  onAsk: () => void;
  asking: boolean;
};

export function SearchBar({ value, onChange, onEnter, onAsk, asking }: Props) {
  return (
    <div role="search" className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
        />
        <Input
          type="text"
          dir="auto"
          aria-label="Search contacts"
          placeholder="Search contacts…"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={MAX_LENGTH}
          value={value}
          className="ps-9 pe-11"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              onEnter();
            } else if (event.key === "Escape" && value) {
              event.preventDefault();
              onChange("");
            }
          }}
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute end-0 top-0 flex size-11 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-900"
            onClick={(event) => {
              onChange("");
              // Back to the box, ready for the next search.
              event.currentTarget.parentElement?.querySelector("input")?.focus();
            }}
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      <Button className="shrink-0" disabled={asking || !value.trim()} onClick={onAsk}>
        {asking ? <Spinner /> : <Sparkles aria-hidden className="size-4" />}
        {asking ? "Asking…" : "Ask AI"}
      </Button>
    </div>
  );
}
