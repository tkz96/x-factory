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
 * Formats an ISO instant as `HH:mm:ss DD-MM-YYYY` (24-hour clock, zero-padded) in the
 * viewer's local time zone.
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
  return `${get("hour")}:${get("minute")}:${get("second")} ${get("day")}-${get("month")}-${get("year")}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The app's one relative clock (#261, #264): "Just now", "2 min ago" or "3 h ago" for
 * the last day, and the exact `formatTimestamp` form once it is older. Callers put the
 * exact time in a hover title, so the relative label never hides the precise one.
 */
export function formatRelativeTime(
  iso: string,
  now: number = Date.now(),
): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return formatTimestamp(iso);
}

/** An ISO instant as `HH:mm` (24-hour clock) in the viewer's local time zone. */
export function formatClockTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * The run timeline's clock: relative for the last hour, so a live run reads as it happens,
 * then the time of day. The run's date is shown once, in Run details, not on every line.
 */
export function formatTimelineTime(
  iso: string,
  now: number = Date.now(),
  timeZone?: string,
): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return iso;
  return now - time < HOUR_MS
    ? formatRelativeTime(iso, now)
    : formatClockTime(iso, timeZone);
}

/** "14 Oct 2026, 11:20": a run's start, once, where the timeline shows only times of day. */
export function formatRunDate(
  iso: string | null | undefined,
  timeZone?: string,
): string {
  if (!iso) return "Not started";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}
