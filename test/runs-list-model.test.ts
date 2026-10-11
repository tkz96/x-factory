// The Runs list model (#259): filter groups, counts, default choice and
// relative time, all derived from the status → UI mapping.

import { describe, expect, it } from "bun:test";
import {
  countRunsByFilter,
  defaultRunsFilter,
  filterRunsList,
  formatRelativeTime,
  parseRunsFilter,
  RUNS_FILTERS,
} from "../src/frontend/lib/runs-list.js";
import type { Run, RunStatus } from "../src/shared/types.js";

function run(id: string, status: RunStatus): Run {
  return {
    id,
    project: { id: "p", name: "Project" },
    ticket: { id: `T-${id}`, title: `Ticket ${id}`, acceptanceCriteria: [] },
    status,
    startedAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
  } as unknown as Run;
}

const RUNS = [
  run("a", "awaiting_plan_approval"),
  run("b", "executing"),
  run("c", "pr_created"),
  run("d", "recovery_required"),
  run("e", "failed"),
];

describe("Runs filter groups", () => {
  it("offers Needs you, Running, Done and All in that order", () => {
    expect(RUNS_FILTERS.map((f) => [f.id, f.label])).toEqual([
      ["needs-you", "Needs you"],
      ["running", "Running"],
      ["done", "Done"],
      ["all", "All"],
    ]);
  });

  it("puts each run in the group the status mapping names", () => {
    expect(filterRunsList(RUNS, "needs-you").map((r) => r.id)).toEqual([
      "a",
      "d",
    ]);
    expect(filterRunsList(RUNS, "running").map((r) => r.id)).toEqual(["b"]);
    expect(filterRunsList(RUNS, "done").map((r) => r.id)).toEqual(["c", "e"]);
    expect(filterRunsList(RUNS, "all").map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("counts each segment, and the Needs-you count is the badge count", () => {
    expect(countRunsByFilter(RUNS)).toEqual({
      "needs-you": 2,
      running: 1,
      done: 2,
      all: 5,
    });
  });
});

describe("Runs filter default", () => {
  it("chooses Needs you whenever a run waits for the user", () => {
    expect(defaultRunsFilter({ needsYouCount: 1, lastChosen: "done" })).toBe(
      "needs-you",
    );
  });

  it("keeps the last chosen filter when nothing waits", () => {
    expect(defaultRunsFilter({ needsYouCount: 0, lastChosen: "done" })).toBe(
      "done",
    );
  });

  it("starts on Running before any choice has been made", () => {
    expect(defaultRunsFilter({ needsYouCount: 0, lastChosen: null })).toBe(
      "running",
    );
  });

  it("reads only known filter ids from the URL", () => {
    expect(parseRunsFilter("done")).toBe("done");
    expect(parseRunsFilter("needs-you")).toBe("needs-you");
    expect(parseRunsFilter("bogus")).toBeUndefined();
    expect(parseRunsFilter(null)).toBeUndefined();
  });
});

describe("Relative time on a row", () => {
  const now = Date.parse("2026-10-11T12:00:00.000Z");

  it("says how long ago the run last changed, in plain words", () => {
    expect(formatRelativeTime("2026-10-11T11:59:40.000Z", now)).toBe(
      "just now",
    );
    expect(formatRelativeTime("2026-10-11T11:55:00.000Z", now)).toBe(
      "5 minutes ago",
    );
    expect(formatRelativeTime("2026-10-11T09:00:00.000Z", now)).toBe(
      "3 hours ago",
    );
    expect(formatRelativeTime("2026-10-08T12:00:00.000Z", now)).toBe(
      "3 days ago",
    );
  });

  it("returns the input unchanged when it is not a time", () => {
    expect(formatRelativeTime("not a time", now)).toBe("not a time");
  });
});
