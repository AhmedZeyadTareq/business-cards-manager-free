"use client";

import { useState } from "react";
import { useMe } from "@/components/MeProvider";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateMessage } from "@/components/ui/spinner";
import { query } from "@/lib/api";
import { formatDateTime } from "@/lib/dates";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import type { AuditItem } from "@/modules/accounts/account.schema";

const PAGE_SIZE = 50;

const ACTIONS: Record<
  AuditItem["action"],
  { label: string; tone: "green" | "amber" | "red" | "grey" }
> = {
  create: { label: "Added", tone: "green" },
  update: { label: "Edited", tone: "amber" },
  delete: { label: "Deleted", tone: "red" },
  export: { label: "Exported", tone: "grey" },
};

// One grid for the header and every row, so the columns line up from `md` up.
const COLUMNS =
  "md:grid md:grid-cols-[10.5rem_minmax(0,1fr)_6rem_minmax(0,2fr)_minmax(0,1fr)] md:items-center md:gap-3";

export default function Page() {
  const me = useMe();
  return (
    <div className="max-w-5xl">
      <PageHeader title="Activity">
        Who added, edited, deleted or exported contacts. Newest first.
      </PageHeader>
      {me.can.admin ? (
        <ActivityList />
      ) : (
        <StateMessage kind="error">Only administrators can do this.</StateMessage>
      )}
    </div>
  );
}

function ActivityList() {
  const me = useMe();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<{ items: AuditItem[]; total: number }>(
    `/api/admin/activity${query({ page, pageSize: PAGE_SIZE })}`,
  );

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full">
          <StateMessage kind="error">{error}</StateMessage>
        </div>
        <Button variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (!data) return <StateMessage kind="loading">Loading activity…</StateMessage>;
  if (data.total === 0) return <StateMessage kind="empty">No activity yet.</StateMessage>;

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const departmentName = (id?: string) =>
    (id && me.departments?.find((department) => department.id === id)?.name) || "";

  return (
    <div aria-busy={loading}>
      <div
        className={cn(
          "hidden border-b border-zinc-200 px-3 pb-2 text-xs font-medium text-zinc-500",
          COLUMNS,
        )}
        aria-hidden
      >
        <span>When</span>
        <span>Who</span>
        <span>Action</span>
        <span>What</span>
        <span>Department</span>
      </div>
      {data.items.length === 0 ? (
        <StateMessage kind="empty">Nothing on this page.</StateMessage>
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-2 md:gap-0 md:divide-y md:divide-zinc-100",
            loading && "opacity-60",
          )}
        >
          {data.items.map((item) => {
            const action = ACTIONS[item.action];
            const department = departmentName(item.departmentId);
            return (
              <li
                key={item.id}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm",
                  "md:rounded-none md:border-0 md:px-3 md:py-2.5",
                  COLUMNS,
                )}
              >
                <span className="text-xs text-zinc-500 md:text-sm md:text-zinc-700">
                  <span className="sr-only">When: </span>
                  {formatDateTime(item.at, me.timeZone)}
                </span>
                <span className="min-w-0 font-medium break-words text-zinc-900" dir="ltr">
                  <span className="sr-only">Who: </span>
                  {item.username}
                </span>
                <span>
                  <span className="sr-only">Action: </span>
                  <Badge tone={action.tone}>{action.label}</Badge>
                </span>
                <span className="min-w-0 break-words text-zinc-800" dir="auto">
                  <span className="sr-only">What: </span>
                  {item.action === "export" ? exportText(item) : (item.contactName ?? "")}
                </span>
                <span className="min-w-0 break-words text-zinc-600" dir="auto">
                  {department ? <span className="sr-only">Department: </span> : null}
                  {department}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <nav
        aria-label="Pages"
        className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600"
      >
        <span aria-live="polite">
          Page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages || loading}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </nav>
    </div>
  );
}

function exportText(item: AuditItem): string {
  const count = item.count ?? 0;
  const text = `${count} ${count === 1 ? "contact" : "contacts"}`;
  return item.detail ? `${text} — ${item.detail}` : text;
}
