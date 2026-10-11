// src/frontend/lib/format-timestamp.ts — The one formatter for every timestamp on the run page (#242).
// Chat bubbles, divider pills and the activity log all render through it, in the viewer's
// local time zone, so a single event always shows a single time.

const PART_TYPES = [
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
] as const;

/**
 * Formats an ISO instant as `YYYY-MM-DD HH:mm:ss` in the viewer's local time zone.
 * `timeZone` exists so tests can pin a zone; callers on the page omit it.
 * An unparseable input is returned unchanged.
 */
export function formatTimestamp(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: (typeof PART_TYPES)[number]) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The run chat's one clock (#261): "Just now", "2 min ago" or "3 h ago" for the last day,
 * and the exact `formatTimestamp` form once it is older. Callers put the exact time in a
 * hover title, so the relative label never hides the precise one.
 */
export function formatRelativeTime(iso: string, now: number): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const elapsed = now - time;
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return formatTimestamp(iso);
}
