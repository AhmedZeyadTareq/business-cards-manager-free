import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  grey: "bg-zinc-100 text-zinc-700",
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-800",
  green: "bg-emerald-50 text-emerald-700",
  primary: "bg-primary/10 text-primary",
} as const;

type Props = HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONES };

export function Badge({ tone = "grey", className, ...props }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
