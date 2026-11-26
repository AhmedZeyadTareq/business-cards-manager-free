import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
      {children ? <p className="mt-1 text-sm text-zinc-600">{children}</p> : null}
    </div>
  );
}
