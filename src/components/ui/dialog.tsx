"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  /** Called on Esc, a backdrop click, or the close button. The owner decides whether to close. */
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
};

/** A native modal <dialog>: Esc closes and focus stays inside. */
export function Dialog({ open, onClose, label, className, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className={cn("rounded-lg bg-white p-0 shadow-xl", className)}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
