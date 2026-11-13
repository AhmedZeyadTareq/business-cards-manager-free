"use client";

import { useEffect } from "react";

// Asks before leaving a page with unsaved work: reload / close (beforeunload) and
// sidebar links (confirmLeave). The browser Back button cannot be guarded.

const dirty = new Set<string>();

export function hasUnsaved(): boolean {
  return dirty.size > 0;
}

/** true = it is fine to leave. */
export function confirmLeave(message = "You have unsaved work. Leave without saving?"): boolean {
  if (!hasUnsaved()) return true;
  const leave = window.confirm(message);
  if (leave) dirty.clear();
  return leave;
}

/** Marks this page as having unsaved work while `isDirty` is true. */
export function useUnsaved(key: string, isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    dirty.add(key);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      dirty.delete(key);
      window.removeEventListener("beforeunload", warn);
    };
  }, [key, isDirty]);
}
