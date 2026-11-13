import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-primary text-white hover:bg-primary-dark",
  outline: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50",
  ghost: "text-zinc-700 hover:bg-zinc-100",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: "md" | "sm";
};

export function Button({ variant = "primary", size = "md", className, type, ...props }: Props) {
  return (
    <button
      type={type ?? "button"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "min-h-11 px-4 text-sm" : "min-h-11 px-3 text-sm sm:min-h-9",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
