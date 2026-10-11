// test/run-chat-time.test.ts — One clock for the run chat: relative for recent times, exact otherwise (#261).

import { describe, expect, it } from "bun:test";
import {
  formatRelativeTime,
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
