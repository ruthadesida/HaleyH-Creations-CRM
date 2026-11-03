/**
 * Date helpers that work in the business's time zone (Africa/Lagos for HaleyH),
 * not the server's. Dates are ISO "YYYY-MM-DD" strings unless noted.
 */

export const DEFAULT_TZ = "Africa/Lagos";

/** Today's date in the given time zone, e.g. "2026-11-03". */
export function todayIn(tz = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** The UTC instant at which a local calendar day ends (exclusive), for timestamptz comparisons. */
export function endOfDayUtc(isoDate: string, tz = DEFAULT_TZ): string {
  return localMidnightUtc(addDays(isoDate, 1), tz);
}

/** The UTC instant of local midnight at the start of `isoDate` in `tz`. */
export function localMidnightUtc(isoDate: string, tz = DEFAULT_TZ): string {
  const guess = new Date(`${isoDate}T00:00:00Z`);
  const offsetMs = tzOffsetMs(guess, tz);
  return new Date(guess.getTime() - offsetMs).toISOString();
}

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** A `datetime-local` value ("2026-11-04T10:30") in the business time zone → UTC ISO string. */
export function zonedInputToUtc(local: string, tz = DEFAULT_TZ): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const asIfUtc = new Date(`${local}:00Z`);
  // Two passes handle DST edges in zones that have them.
  let utc = asIfUtc.getTime() - tzOffsetMs(asIfUtc, tz);
  utc = asIfUtc.getTime() - tzOffsetMs(new Date(utc), tz);
  return new Date(utc).toISOString();
}

/** UTC ISO string → `datetime-local` value in the business time zone. */
export function utcToZonedInput(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() + tzOffsetMs(d, tz)).toISOString().slice(0, 16);
}

/** The UTC instant `days` days before now. */
export function daysAgoIso(days: number, now = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** "3 Nov" (or "3 Nov 2025" when not this year). */
export function formatDate(iso: string | null | undefined, tz = DEFAULT_TZ, now = new Date()): string {
  if (!iso) return "";
  const date = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  const sameYear = todayIn(tz, now).slice(0, 4) === todayIn(tz, date).slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: iso.length === 10 ? "UTC" : tz,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** "3 Nov, 14:30" in the business time zone. */
export function formatDateTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
}

/** Days from today to a date (negative = in the past), in the business time zone. */
export function daysUntil(isoDate: string, tz = DEFAULT_TZ, now = new Date()): number {
  const today = Date.parse(`${todayIn(tz, now)}T00:00:00Z`);
  return Math.round((Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) - today) / 86_400_000);
}

/** "Today", "Tomorrow", "In 3 days", "Yesterday", "5 days overdue". */
export function relativeDue(isoDate: string, tz = DEFAULT_TZ, now = new Date()): string {
  const d = daysUntil(isoDate, tz, now);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d > 1) return `In ${d} days`;
  return `${-d} days overdue`;
}
