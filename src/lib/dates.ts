// Dates in the app time zone (APP_TIME_ZONE). Used by the server and the pages.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsIn(date: Date, timeZone: string): Parts & { second: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of a moment, as seen in the time zone. */
export function dayInZone(date: Date, timeZone: string): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The moment a calendar day starts in the time zone. */
export function startOfDay(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall;
  // Two passes settle the offset, also across a daylight-saving change.
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess = wall - (shown - guess);
  }
  return new Date(guess);
}

export function addDays(day: string, count: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + count)).toISOString().slice(0, 10);
}

/** The moment the day after `day` starts: the exclusive end of a whole-day range. */
export function endOfDay(day: string, timeZone: string): Date {
  return startOfDay(addDays(day, 1), timeZone);
}

/** `2 Nov 2026` */
export function formatDate(value: string | Date, timeZone: string): string {
  const p = partsIn(new Date(value), timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** `2 Nov 2026, 14:05` */
export function formatDateTime(value: string | Date, timeZone: string): string {
  const p = partsIn(new Date(value), timeZone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}
