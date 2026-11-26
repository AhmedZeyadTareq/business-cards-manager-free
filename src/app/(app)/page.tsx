"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { ContactForm } from "@/components/ContactForm";
import { ContactTable, type Sort } from "@/components/ContactTable";
import {
  type Creator,
  type DepartmentOption,
  ExploreFilters,
  type Filters,
  NO_FILTERS,
  type ValueCount,
} from "@/components/ExploreFilters";
import { useMe } from "@/components/MeProvider";
import { Overview, useOverview } from "@/components/Overview";
import { PageHeader } from "@/components/PageHeader";
import { SearchBar } from "@/components/SearchBar";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Spinner, StateMessage } from "@/components/ui/spinner";
import { api, errorMessage, query } from "@/lib/api";
import { dayInZone, formatDate, startOfDay } from "@/lib/dates";
import { useApi } from "@/lib/use-api";
import type { Contact } from "@/modules/contacts/contact.schema";

const PAGE_SIZE = 25;
/** Quick search shows 20 matches, then 20 more each time, up to 1,000. */
const STEP = 20;
const MAX_RESULTS = 1000;
/** The longest text `GET /api/search` takes. */
const MAX_QUICK = 200;
const PAUSE_MS = 150;

type List = { items: Contact[]; total: number };
/** A quick-search result, with the request it answers. */
type Quick = List & { key: string; q: string };
type Ask = { status: "busy" } | { status: "done"; answer: string; contacts: Contact[] };

const number = (value: number) => value.toLocaleString("en-US");
const results = (count: number) => `${number(count)} ${count === 1 ? "result" : "results"}`;

const replaceIn = (items: Contact[], updated: Contact) =>
  items.map((item) => (item.id === updated.id ? updated : item));
const has = (items: Contact[], id: string) => items.some((item) => item.id === id);
const without = (items: Contact[], id: string) => items.filter((item) => item.id !== id);

/** The filters that are set, as the person reads them. */
function describeFilters(
  filters: Filters,
  timeZone: string,
  creators: Creator[] = [],
  departments: DepartmentOption[] = [],
): string[] {
  const parts: string[] = [];
  const day = (value: string) => formatDate(startOfDay(value, timeZone), timeZone);
  if (filters.CreatedBy) {
    const creator = creators.find((item) => item.id === filters.CreatedBy);
    parts.push(`Added by: ${creator ? creator.name || creator.username : "selected person"}`);
  }
  if (filters.City) parts.push(`City: ${filters.City}`);
  if (filters.Sector) parts.push(`Sector: ${filters.Sector}`);
  if (filters.DepartmentId) {
    const department = departments.find((item) => item.id === filters.DepartmentId);
    parts.push(`Department: ${department?.name ?? "selected department"}`);
  }
  if (filters.dateFrom) parts.push(`Date from: ${day(filters.dateFrom)}`);
  if (filters.dateTo) parts.push(`Date to: ${day(filters.dateTo)}`);
  return parts;
}

/** A normal download navigation: the browser saves the file and the page stays. */
function ExportButton({
  label,
  href,
  disabled,
}: {
  label: string;
  href: string;
  disabled: boolean;
}) {
  return (
    <Button variant="outline" disabled={disabled} onClick={() => window.location.assign(href)}>
      <Download aria-hidden className="size-4" />
      {label}
    </Button>
  );
}

export default function ExplorePage() {
  const me = useMe();
  const toast = useToast();
  const timeZone = me.timeZone;

  // "Today" in the app time zone. The page stays open all day, so it is checked every minute.
  const [today, setToday] = useState(() => dayInZone(new Date(), timeZone));
  useEffect(() => {
    const timer = window.setInterval(() => setToday(dayInZone(new Date(), timeZone)), 60_000);
    return () => window.clearInterval(timer);
  }, [timeZone]);

  // ---------- Table ----------
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>({ field: "CreatedAt", dir: "desc" });
  const filtered = Object.values(filters).some(Boolean);

  // Each of these loads again when the page is shown again (contacts may have been added).
  const list = useApi<List>(
    `/api/contacts${query({ page, pageSize: PAGE_SIZE, sort: sort.field, dir: sort.dir, ...filters })}`,
  );
  const overview = useOverview(today);
  const cities = useApi<ValueCount[]>("/api/contacts/values?field=City");
  const creators = useApi<Creator[]>("/api/contacts/creators");

  const departmentNames = useMemo(
    () =>
      me.departments
        ? new Map(me.departments.map((department) => [department.id, department.name]))
        : undefined,
    [me.departments],
  );

  const listTop = useRef<HTMLDivElement>(null);

  const changeFilters = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(NO_FILTERS);
    setPage(1);
  };
  const changeSort = useCallback((next: Sort) => {
    setSort(next);
    setPage(1);
  }, []);
  const goToPage = (next: number) => {
    setPage(next);
    // The new page starts at its top when the pager was reached by scrolling down.
    const top = listTop.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: "start" });
  };

  // ---------- Search ----------
  const [text, setText] = useState("");
  const [limit, setLimit] = useState(STEP);
  const [attempt, setAttempt] = useState(0);
  const [quick, setQuick] = useState<Quick | null>(null);
  const [quickError, setQuickError] = useState<{ key: string; message: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askError, setAskError] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  /** Enter was pressed before the quick search returned: open the first match when it does. */
  const enterPending = useRef(false);
  const askRequest = useRef<AbortController | null>(null);

  const q = text.trim();
  const mode = ask ? "ask" : q.length >= 2 ? "quick" : "table";
  const tooLong = q.length > MAX_QUICK;
  const quickKey = mode === "quick" && !tooLong ? `${attempt}|${limit}|${q}` : null;

  // Quick search: runs after a short pause in typing. A newer request (or leaving the page)
  // aborts the older one, so an old answer never replaces a newer one.
  useEffect(() => {
    if (quickKey === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<List>(`/api/search${query({ q, limit })}`, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setQuick({ ...result, key: quickKey, q });
          if (enterPending.current) {
            enterPending.current = false;
            if (result.items.length > 0) setSelected(result.items[0]);
          }
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          enterPending.current = false;
          setQuickError({ key: quickKey, message: errorMessage(cause) });
        });
    }, PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [quickKey, q, limit]);

  const quickCurrent = quick !== null && quick.key === quickKey;
  const quickFailed = quickError !== null && quickError.key === quickKey;
  /** The shown matches belong to the text in the box (maybe with fewer rows than asked). */
  const quickSameText = quick !== null && quick.q === q;

  const changeText = (value: string) => {
    setText(value);
    setLimit(STEP);
    enterPending.current = false;
    // Editing the text leaves an AI answer (or a running question) behind.
    askRequest.current?.abort();
    askRequest.current = null;
    setAsk(null);
    setAskError("");
    if (value.trim().length < 2) setQuick(null);
  };

  const askAi = () => {
    if (!q) return;
    askRequest.current?.abort();
    const controller = new AbortController();
    askRequest.current = controller;
    enterPending.current = false;
    setAskError("");
    setAsk({ status: "busy" });
    api<{ answer: string; contacts: Contact[] }>("/api/ask", {
      method: "POST",
      body: { question: q },
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setAsk({ status: "done", answer: result.answer, contacts: result.contacts });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        // The message shows above the quick-search matches, which still work.
        setAsk(null);
        setAskError(errorMessage(cause));
      });
  };

  const openFirst = () => {
    if (ask) {
      if (ask.status === "done" && ask.contacts.length > 0) setSelected(ask.contacts[0]);
    } else if (quickKey !== null) {
      if (!quickSameText) enterPending.current = true;
      else if (quick.items.length > 0) setSelected(quick.items[0]);
    }
  };

  // ---------- After a save or a delete ----------
  const reloadAll = () => {
    list.reload();
    overview.reload();
    cities.reload();
    creators.reload();
  };

  const onSaved = (updated: Contact) => {
    toast("Contact saved.");
    setSelected(null);
    // The search stays as it is; its rows are updated in place.
    if (list.data) list.setData({ ...list.data, items: replaceIn(list.data.items, updated) });
    setQuick((current) => current && { ...current, items: replaceIn(current.items, updated) });
    setAsk((current) =>
      current?.status === "done"
        ? { ...current, contacts: replaceIn(current.contacts, updated) }
        : current,
    );
    reloadAll();
  };

  const onDeleted = (id: string) => {
    toast("Contact deleted.");
    setSelected(null);
    if (list.data && has(list.data.items, id)) {
      list.setData({ items: without(list.data.items, id), total: list.data.total - 1 });
      // The last row of the last page is gone: show the page before it.
      if (list.data.items.length === 1 && page > 1) setPage(page - 1);
    }
    setQuick((current) =>
      current && has(current.items, id)
        ? { ...current, items: without(current.items, id), total: current.total - 1 }
        : current,
    );
    setAsk((current) =>
      current?.status === "done"
        ? { ...current, contacts: without(current.contacts, id) }
        : current,
    );
    reloadAll();
  };

  const closeDialog = useCallback(() => setSelected(null), []);

  // ---------- What is on screen ----------
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filterNames =
    mode !== "table" && filtered
      ? describeFilters(filters, timeZone, creators.data, me.departments)
      : [];
  const askContacts = ask?.status === "done" ? ask.contacts : [];

  return (
    <div className="mx-auto max-w-[96rem]">
      <PageHeader title="Explore" />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <SearchBar
            value={text}
            onChange={changeText}
            onEnter={openFirst}
            onAsk={askAi}
            asking={ask?.status === "busy"}
          />
          {askError ? (
            <p
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {askError}
            </p>
          ) : null}
        </div>

        {filterNames.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="min-w-0 flex-1 basis-64">
              A search covers all your contacts. These filters do not apply:{" "}
              <span dir="auto" className="font-medium wrap-anywhere">
                {filterNames.join(", ")}
              </span>
              .
            </p>
            <Button variant="outline" size="sm" onClick={() => changeText("")}>
              Back to filtered table
            </Button>
          </div>
        ) : null}

        {mode === "table" ? (
          <>
            <Overview
              data={overview}
              activeSector={filters.Sector}
              onSector={(sector) => changeFilters({ Sector: sector })}
            />
            <ExploreFilters
              filters={filters}
              onChange={changeFilters}
              onClear={clearFilters}
              creators={creators.data}
              cities={cities.data}
              departments={me.departments}
            >
              {me.can.export ? (
                <ExportButton
                  label={filtered ? "Export CSV (filtered)" : "Export CSV"}
                  href={`/api/contacts/export${query(filters)}`}
                  disabled={!list.data || total === 0}
                />
              ) : null}
            </ExploreFilters>

            <div ref={listTop} className="flex scroll-mt-4 flex-col gap-3">
              {list.error ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <StateMessage kind="error">{list.error}</StateMessage>
                  </div>
                  <Button variant="outline" onClick={list.reload}>
                    Try again
                  </Button>
                </div>
              ) : null}
              {!list.data ? (
                list.error ? null : (
                  <StateMessage kind="loading">Loading contacts…</StateMessage>
                )
              ) : total === 0 ? (
                list.loading ? (
                  <StateMessage kind="loading">Loading contacts…</StateMessage>
                ) : filtered ? (
                  <StateMessage kind="empty">No contacts match these filters.</StateMessage>
                ) : (
                  <StateMessage kind="empty">
                    No contacts yet.
                    {me.can.add ? (
                      <>
                        {" "}
                        Add one with{" "}
                        <Link href="/add/text" className="font-medium text-primary underline">
                          Add from Text
                        </Link>{" "}
                        or{" "}
                        <Link href="/add/photo" className="font-medium text-primary underline">
                          Add from Photo
                        </Link>
                        .
                      </>
                    ) : null}
                  </StateMessage>
                )
              ) : (
                <>
                  {list.data.items.length === 0 && !list.loading ? (
                    <StateMessage kind="empty">No contacts on this page.</StateMessage>
                  ) : (
                    <ContactTable
                      contacts={list.data.items}
                      timeZone={timeZone}
                      onOpen={setSelected}
                      sort={sort}
                      onSort={changeSort}
                      departmentNames={departmentNames}
                      stale={list.loading}
                    />
                  )}
                  <nav
                    aria-label="Pages"
                    className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600"
                  >
                    <p aria-live="polite">
                      {number(total)} {total === 1 ? "contact" : "contacts"}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => goToPage(Math.min(page - 1, pageCount))}
                      >
                        Previous
                      </Button>
                      <span className="tabular-nums">
                        Page {number(page)} of {number(pageCount)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= pageCount}
                        onClick={() => goToPage(page + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </nav>
                </>
              )}
            </div>
          </>
        ) : null}

        {mode === "quick" ? (
          <section aria-label="Search results" className="flex flex-col gap-3">
            {tooLong ? (
              <StateMessage kind="empty">
                This text is too long for quick search. Use Ask AI.
              </StateMessage>
            ) : null}
            {quickFailed ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <StateMessage kind="error">{quickError.message}</StateMessage>
                </div>
                <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
              </div>
            ) : null}
            {tooLong || quickFailed ? null : quickCurrent && quick.total === 0 ? (
              <>
                <StateMessage kind="empty">No matches. Try Ask AI.</StateMessage>
                {me.can.export ? (
                  <div className="flex justify-end">
                    <ExportButton label="Export 0 results" href="" disabled />
                  </div>
                ) : null}
              </>
            ) : quick === null || quick.total === 0 ? (
              <StateMessage kind="loading">Searching…</StateMessage>
            ) : (
              <>
                <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                  <p aria-live="polite" className="text-sm text-zinc-600">
                    Showing {number(quick.items.length)} of {results(quick.total)}
                  </p>
                  {me.can.export ? (
                    <ExportButton
                      label={`Export ${results(quick.total)}`}
                      href={`/api/contacts/export${query({ q: quick.q })}`}
                      disabled={!quickSameText}
                    />
                  ) : null}
                </div>
                <ContactTable
                  contacts={quick.items}
                  timeZone={timeZone}
                  onOpen={setSelected}
                  departmentNames={departmentNames}
                  stale={!quickSameText}
                />
                {quickSameText && quick.items.length < Math.min(quick.total, MAX_RESULTS) ? (
                  <div className="flex justify-center">
                    <Button
                      variant="outline"
                      disabled={!quickCurrent}
                      onClick={() => setLimit(Math.min(quick.items.length + STEP, MAX_RESULTS))}
                    >
                      {quickCurrent ? null : <Spinner />}
                      Show more
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {ask ? (
          <section aria-label="AI answer" className="flex flex-col gap-3">
            {ask.status === "busy" ? (
              <div
                role="status"
                className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 text-sm text-zinc-700"
              >
                <Spinner className="shrink-0 text-primary" />
                <span>Asking the AI… This can take up to a couple of minutes.</span>
              </div>
            ) : (
              <>
                <div
                  role="status"
                  className="flex gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
                >
                  <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-primary">AI answer</p>
                    <p
                      dir="auto"
                      className="mt-0.5 text-sm whitespace-pre-line text-zinc-900 wrap-anywhere"
                    >
                      {ask.answer}
                    </p>
                  </div>
                </div>
                {askContacts.length === 0 ? (
                  <>
                    <StateMessage kind="empty">The AI found no matching contacts.</StateMessage>
                    {me.can.export ? (
                      <div className="flex justify-end">
                        <ExportButton label="Export 0 results" href="" disabled />
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-zinc-600">{results(askContacts.length)}</p>
                      {me.can.export ? (
                        <ExportButton
                          label={`Export ${results(askContacts.length)}`}
                          href={`/api/contacts/export${query({
                            ids: askContacts.map((contact) => contact.id).join(","),
                          })}`}
                          disabled={false}
                        />
                      ) : null}
                    </div>
                    <ContactTable
                      contacts={askContacts}
                      timeZone={timeZone}
                      onOpen={setSelected}
                      departmentNames={departmentNames}
                    />
                  </>
                )}
              </>
            )}
          </section>
        ) : null}
      </div>

      <ContactForm
        key={selected?.id ?? "none"}
        contact={selected}
        onClose={closeDialog}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  );
}
