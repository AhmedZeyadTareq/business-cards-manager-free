import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-4 animate-spin", className)} />;
}

/** Loading, empty and error states share one look. */
export function StateMessage({
  kind,
  children,
}: {
  kind: "loading" | "empty" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-4 py-8 text-sm",
        kind === "error"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-zinc-200 bg-zinc-50 text-zinc-600",
      )}
    >
      {kind === "loading" ? <Spinner /> : null}
      <span>{children}</span>
    </div>
  );
}
