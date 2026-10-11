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

/**
 * A short relative time for recent instants ("Just now", "5 min ago", "3 h ago"),
 * and the full timestamp for anything a day or more old. The notification list uses
 * it; the exact time belongs in a hover title.
 */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatTimestamp(iso);
}
