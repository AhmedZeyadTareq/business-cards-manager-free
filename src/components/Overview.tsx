"use client";

import { query } from "@/lib/api";
import { addDays } from "@/lib/dates";
import { useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { SECTORS, type Sector } from "@/modules/contacts/contact.schema";
import { Button } from "./ui/button";
import { StateMessage } from "./ui/spinner";

type Count = { total: number };
type ValueCount = { value: string; count: number };

export type OverviewData = {
  total?: number;
  month?: number;
  week?: number;
  /** All six sectors, most contacts first. */
  sectors?: { sector: Sector; count: number }[];
  error: string;
  reload: () => void;
};

const number = (value: number) => value.toLocaleString("en-US");

/**
 * The overview figures for everything the person can see (the table filters do not apply).
 * `today` is `YYYY-MM-DD` in the app time zone.
 */
export function useOverview(today: string): OverviewData {
  const total = useApi<Count>("/api/contacts?pageSize=1");
  const month = useApi<Count>(
    `/api/contacts${query({ pageSize: 1, dateFrom: `${today.slice(0, 7)}-01` })}`,
  );
  const week = useApi<Count>(
    `/api/contacts${query({ pageSize: 1, dateFrom: addDays(today, -6) })}`,
  );
  const sectors = useApi<ValueCount[]>("/api/contacts/values?field=Sector");

  const counts = sectors.data;
  const ranked = counts
    ? SECTORS.map((sector) => ({
        sector,
        count: counts.find((row) => row.value === sector)?.count ?? 0,
      })).sort((a, b) => b.count - a.count)
    : undefined;

  return {
    total: total.data?.total,
    month: month.data?.total,
    week: week.data?.total,
    sectors: ranked,
    error: total.error || month.error || week.error || sectors.error,
    reload: () => {
      total.reload();
      month.reload();
      week.reload();
      sectors.reload();
    },
  };
}

function Figure({ label, value, note }: { label: string; value?: number; note?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3">
      <p className="text-xs font-medium text-zinc-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 tabular-nums">
        {value === undefined ? <span className="text-zinc-300">–</span> : number(value)}
      </p>
      {/* The line is always there, so the strip keeps its height while loading. */}
      <p className="mt-0.5 min-h-4 text-xs text-zinc-500">{note}</p>
    </div>
  );
}

type Props = {
  data: OverviewData;
  /** The sector the table is filtered by, if any. */
  activeSector: string;
  /** Called with the clicked sector, or "" when the active one is clicked again. */
  onSector: (sector: Sector | "") => void;
};

export function Overview({ data, activeSector, onSector }: Props) {
  const { total, month, week, sectors } = data;
  const sum = sectors?.reduce((all, row) => all + row.count, 0) ?? 0;
  const top = sectors?.[0]?.count ?? 0;
  const rows = sectors ?? SECTORS.map((sector) => ({ sector, count: 0 }));

  return (
    <section aria-label="Overview" className="flex flex-col gap-3">
      {data.error ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <StateMessage kind="error">{data.error}</StateMessage>
          </div>
          <Button variant="outline" onClick={data.reload}>
            Try again
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Figure label="Total contacts" value={total} />
          <Figure
            label="Added this month"
            value={month}
            note={week === undefined ? undefined : `${number(week)} in the last 7 days`}
          />
        </div>
        <div className="rounded-lg border border-zinc-200 px-2 py-2">
          <p className="px-2 pt-1 pb-1 text-xs font-medium text-zinc-600">Contacts per sector</p>
          <ul aria-busy={sectors ? undefined : true}>
            {rows.map((row) => {
              const active = row.sector === activeSector;
              const share = sum > 0 ? Math.round((row.count / sum) * 100) : 0;
              return (
                <li key={row.sector}>
                  <button
                    type="button"
                    aria-pressed={active}
                    title={active ? "Remove this filter" : "Show only this sector"}
                    className={cn(
                      "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1 text-left",
                      "sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]",
                      active ? "bg-primary/10" : "hover:bg-zinc-50",
                    )}
                    onClick={() => onSector(active ? "" : row.sector)}
                  >
                    <span
                      className={cn(
                        "text-sm wrap-anywhere",
                        active ? "font-semibold text-primary" : "text-zinc-800",
                      )}
                    >
                      {row.sector}
                    </span>
                    <span
                      aria-hidden
                      className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-zinc-100 sm:order-none sm:col-span-1"
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: top > 0 ? `${(row.count / top) * 100}%` : "0%" }}
                      />
                    </span>
                    <span className="text-xs text-zinc-600 tabular-nums">
                      {sectors ? (
                        <>
                          <span className="font-semibold text-zinc-900">{number(row.count)}</span>
                          {" · "}
                          {share}%
                        </>
                      ) : (
                        "–"
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
