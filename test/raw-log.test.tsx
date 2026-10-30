// test/raw-log.test.tsx — The raw log renders through the one event mapping, names stages with the
// workflow labels, and scrolls only when the reader is at the end (spec #312 ticket 10).

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { RawLog } from "../src/frontend/components/runs/RawLog.js";
import { STAGE_LABELS } from "../src/frontend/lib/workflow-stages.js";
import type { RunEvent } from "../src/shared/types.js";

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-10-20T10:00:00.000Z";

function ev(id: number, type: string, payload: unknown): RunEvent {
  return { id, type, payload, timestamp: AT } as unknown as RunEvent;
}

function logOf(container: HTMLElement): HTMLElement {
  const log = container.querySelector(".chat-thread-container");
  if (!(log instanceof HTMLElement)) throw new Error("no log container");
  return log;
}

/** The scroll metrics a real browser gives and happy-dom reports as zero. */
function giveMetrics(
  el: HTMLElement,
  {
    scrollHeight,
    clientHeight,
  }: { scrollHeight: number; clientHeight: number },
) {
  Object.defineProperty(el, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
}

describe("RawLog renders through the one event mapping (#322)", () => {
  it("names a stage with the workflow label, never a verb or the raw id", () => {
    const { container } = render(
      React.createElement(RawLog, {
        events: [
          ev(1, "stage_evidence", {
            stage: "execute",
            evidence: "bun test passed",
          }),
        ],
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain(STAGE_LABELS.execute);
    expect(text).not.toContain("Coding");
  });

  it("shows nothing for an event type the mapping does not know, never invented text", () => {
    const { container } = render(
      React.createElement(RawLog, {
        events: [ev(1, "steer", { message: "legacy steer note" })],
      }),
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("legacy steer note");
    expect(text).not.toContain("Steer Action");
    expect(text).toContain("Waiting");
  });
});

describe("RawLog renders every kind the mapping gives it (#322)", () => {
  const events: RunEvent[] = [
    ev(1, "plan_ready", { plan: "1. Read the parser" }),
    ev(2, "diff_summary", {
      files: [{ path: "src/a.ts", added: 4, removed: 1 }],
      totalAdded: 4,
      totalRemoved: 1,
    }),
    ev(3, "review_activity", { tool: "read", text: "Running tool read" }),
    ev(4, "verification", {
      result: { passed: true, summary: "12 of 12 passed" },
    }),
    ev(5, "review", {
      result: { passed: false, summary: "1 criterion unmet" },
    }),
    ev(6, "chat_user", { text: "Please continue" }),
    ev(7, "chat_agent", { text: "Continuing now" }),
    ev(8, "error", { message: "The model quota ran out" }),
  ];

  it("shows each item's own text, in the bubble its kind dresses", () => {
    const { container } = render(React.createElement(RawLog, { events }));
    const text = container.textContent ?? "";
    expect(text).toContain("1. Read the parser");
    expect(text).toContain("1 file · +4 −1");
    expect(text).toContain("Running tool read");
    expect(text).toContain("Verification passed: 12 of 12 passed");
    expect(text).toContain("Review did not pass: 1 criterion unmet");
    expect(text).toContain("Please continue");
    expect(text).toContain("Continuing now");
    expect(text).toContain("The model quota ran out");
    expect(container.querySelector(".bubble-error")).not.toBeNull();
  });
});

describe("RawLog scrolls only when the reader is at the end (#322)", () => {
  it("follows new events while the reader is at the end", () => {
    const events = [ev(1, "info", { text: "one" })];
    const { container, rerender } = render(
      React.createElement(RawLog, { events }),
    );
    const log = logOf(container);
    giveMetrics(log, { scrollHeight: 1000, clientHeight: 400 });
    rerender(
      React.createElement(RawLog, {
        events: [...events, ev(2, "info", { text: "two" })],
      }),
    );
    expect(log.scrollTop).toBe(1000);
  });

  it("keeps the reader's place when they have scrolled up", () => {
    const events = [ev(1, "info", { text: "one" })];
    const { container, rerender } = render(
      React.createElement(RawLog, { events }),
    );
    const log = logOf(container);
    giveMetrics(log, { scrollHeight: 1000, clientHeight: 400 });
    log.scrollTop = 100;
    fireEvent.scroll(log);
    rerender(
      React.createElement(RawLog, {
        events: [...events, ev(2, "info", { text: "two" })],
      }),
    );
    expect(log.scrollTop).toBe(100);
  });
});
