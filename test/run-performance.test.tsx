// test/run-performance.test.tsx — The run page stays responsive on a long run (#321, spec #312 US27):
// one new event renders one new row, closed stages render nothing, a long stage shows its last 50
// rows, and every time reads one shared minute ticker.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { RunChat } from "../src/frontend/components/runs/RunChat.js";
import * as timestamps from "../src/frontend/lib/format-timestamp.js";
import { refreshMinuteTicker } from "../src/frontend/lib/minute-ticker.js";
import { mapEventsToChatItems } from "../src/frontend/lib/run-chat-items.js";
import type { Run, RunEvent } from "../src/shared/types.js";

afterEach(cleanup);
afterAll(async () => {
  await unregisterHappyDom();
});

const AT = "2026-09-20T12:34:56.000Z";

function makeRun(): Run {
  return {
    id: "run-1",
    project: { id: "p", name: "P" },
    ticket: { id: "T-1", title: "A ticket", url: "", acceptanceCriteria: [] },
    plan: "",
    branch: "b",
    status: "executing",
    startedAt: AT,
    finishedAt: null,
    updatedAt: AT,
    implementationContext: null,
    verification: null,
    review: null,
    artifacts: [],
    diff: null,
    pullRequest: null,
    repairAttempts: 0,
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
  } as Run;
}

function ev(id: number, type: string, payload: unknown) {
  return { id, type, payload, timestamp: AT } as unknown as RunEvent;
}

/** A closed Plan stage with 3 rows, then an open Execute stage with `executeRows` rows. */
function longRun(executeRows: number): RunEvent[] {
  const events = [
    ev(1, "status", { status: "planning" }),
    ev(2, "chat_agent", { text: "plan row a" }),
    ev(3, "chat_agent", { text: "plan row b" }),
    ev(4, "chat_agent", { text: "plan row c" }),
    ev(5, "status", { status: "executing" }),
  ];
  for (let i = 0; i < executeRows; i += 1) {
    events.push(ev(10 + i, "chat_agent", { text: `execute row ${i}` }));
  }
  return events;
}

describe("a long run stays responsive", () => {
  it("renders one new row for one new event", () => {
    const events = longRun(20);
    const run = makeRun();
    const { rerender } = render(<RunChat run={run} events={events} />);
    const rowRenders = spyOn(timestamps, "formatTimelineTime");
    rowRenders.mockClear();

    const next = [...events, ev(500, "chat_agent", { text: "one more" })];
    rerender(<RunChat run={run} events={next} />);

    expect(rowRenders).toHaveBeenCalledTimes(1);
    rowRenders.mockRestore();
  });

  it("keeps a chat item's identity while its event is unchanged", () => {
    const events = longRun(5);
    const before = mapEventsToChatItems(events);
    const after = mapEventsToChatItems([
      ...events,
      ev(500, "chat_agent", { text: "x" }),
    ]);
    expect(
      after.slice(0, before.length).every((item, i) => item === before[i]),
    ).toBe(true);
  });

  it("renders nothing for the rows of a closed stage", () => {
    const { container } = render(
      <RunChat run={makeRun()} events={longRun(3)} />,
    );
    expect(container.textContent).not.toContain("plan row a");
    expect(container.textContent).toContain("execute row 0");
  });

  it("shows the last 50 rows of a long stage, and Show Earlier adds more", () => {
    const { container, getByRole } = render(
      <RunChat run={makeRun()} events={longRun(120)} />,
    );
    expect(container.textContent).not.toContain("execute row 0");
    expect(container.textContent).toContain("execute row 70");
    expect(container.textContent).not.toContain("execute row 69");
    fireEvent.click(getByRole("button", { name: "Show Earlier" }));
    expect(container.textContent).toContain("execute row 20");
    expect(container.textContent).not.toContain("execute row 19");
  });

  it("updates every time label from one minute ticker", () => {
    const intervals = spyOn(globalThis, "setInterval");
    const at = new Date().toISOString();
    const events = longRun(30).map((e) => ({ ...e, timestamp: at }));
    const { container } = render(<RunChat run={makeRun()} events={events} />);
    // RunChat keeps no clock of its own; the rows share one ticker.
    const minute = intervals.mock.calls.filter(([, ms]) => ms === 60_000);
    expect(minute.length).toBeLessThanOrEqual(1);
    intervals.mockRestore();

    expect(within(container).getAllByText("Just now").length).toBeGreaterThan(
      0,
    );
    act(() => refreshMinuteTicker(Date.now() + 5 * 60_000));
    expect(within(container).queryAllByText("Just now").length).toBe(0);
    expect(within(container).getAllByText("5 min ago").length).toBeGreaterThan(
      0,
    );
  });

  it("builds each Intl.DateTimeFormat once", () => {
    timestamps.formatTimestamp(AT, "UTC");
    const Original = Intl.DateTimeFormat;
    let built = 0;
    Intl.DateTimeFormat = new Proxy(Original, {
      construct(target, args) {
        built += 1;
        return Reflect.construct(target, args);
      },
    });
    try {
      for (let i = 0; i < 50; i += 1) timestamps.formatTimestamp(AT, "UTC");
      expect(built).toBe(0);
    } finally {
      Intl.DateTimeFormat = Original;
    }
  });
});
