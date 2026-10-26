// test/run-chat-time.test.ts — One clock for the run chat: relative for recent times, exact otherwise (#261).

import { describe, expect, it } from "bun:test";
import {
  formatClockTime,
  formatRelativeTime,
  formatTimelineTime,
  formatTimestamp,
} from "../src/frontend/lib/format-timestamp.js";

const NOW = Date.parse("2026-09-20T12:40:00.000Z");

describe("formatRelativeTime", () => {
  it("says just now for the last minute", () => {
    expect(formatRelativeTime("2026-09-20T12:39:30.000Z", NOW)).toBe(
      "Just now",
    );
    expect(formatRelativeTime("2026-09-20T12:40:05.000Z", NOW)).toBe(
      "Just now",
    );
  });

  it("counts minutes and hours while the time is recent", () => {
    expect(formatRelativeTime("2026-09-20T12:38:00.000Z", NOW)).toBe(
      "2 min ago",
    );
    expect(formatRelativeTime("2026-09-20T10:40:00.000Z", NOW)).toBe("2 h ago");
  });

  it("falls back to the exact time once a day old", () => {
    const old = "2026-09-18T08:00:00.000Z";
    expect(formatRelativeTime(old, NOW)).toBe(formatTimestamp(old));
  });

  it("returns unparseable input unchanged", () => {
    expect(formatRelativeTime("not a date", NOW)).toBe("not a date");
  });
});

describe("formatTimelineTime — the run timeline's clock", () => {
  const AT = "2026-10-14T06:23:48.000Z";
  const at = new Date(AT).getTime();

  it("is relative within the hour, so a live run reads as it happens", () => {
    expect(formatTimelineTime(AT, at + 30_000, "UTC")).toBe("Just now");
    expect(formatTimelineTime(AT, at + 5 * 60_000, "UTC")).toBe("5 min ago");
  });

  it("is the time of day after that, never the full date on every line", () => {
    expect(formatTimelineTime(AT, at + 2 * 3_600_000, "UTC")).toBe("06:23");
    expect(formatTimelineTime(AT, at + 12 * 86_400_000, "UTC")).toBe("06:23");
    expect(formatClockTime(AT, "Asia/Karachi")).toBe("11:23");
  });
});
