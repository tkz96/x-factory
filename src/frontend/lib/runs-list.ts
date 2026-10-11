// src/frontend/lib/runs-list.ts — The Runs list model (#259, spec #241).
//
// Filter groups, segment counts, the default choice and the row's relative
// time. Groups come from the one status → UI mapping in run-status-ui.ts, so
// the list, its counts and the Runs badge can never disagree.

import type { Run } from "../../shared/types.js";
import { RUN_STATUS_UI, type RunFilter } from "./run-status-ui.js";

export type RunsFilterId = "needs-you" | "running" | "done" | "all";

export const RUNS_FILTERS: ReadonlyArray<{
  id: RunsFilterId;
  label: string;
  group: RunFilter | null;
}> = [
  { id: "needs-you", label: "Needs you", group: "Needs you" },
  { id: "running", label: "Running", group: "Running" },
  { id: "done", label: "Done", group: "Done" },
  { id: "all", label: "All", group: null },
];

export type RunsFilterCounts = Record<RunsFilterId, number>;

/** The filter group a run's status belongs to. */
function groupOf(run: Run): RunFilter {
  return RUN_STATUS_UI[run.status]?.filter ?? "Running";
}

/** The runs one filter segment shows, in the order they were given. */
export function filterRunsList(runs: readonly Run[], filter: RunsFilterId) {
  const group = RUNS_FILTERS.find((f) => f.id === filter)?.group ?? null;
  if (group === null) return [...runs];
  return runs.filter((run) => groupOf(run) === group);
}

/** How many runs each segment holds. */
export function countRunsByFilter(runs: readonly Run[]): RunsFilterCounts {
  return {
    "needs-you": filterRunsList(runs, "needs-you").length,
    running: filterRunsList(runs, "running").length,
    done: filterRunsList(runs, "done").length,
    all: runs.length,
  };
}

/** Parses a `?filter=` value; anything unknown is no choice at all. */
export function parseRunsFilter(
  value: string | null,
): RunsFilterId | undefined {
  return RUNS_FILTERS.find((f) => f.id === value)?.id;
}

/**
 * The filter shown when the URL names none: Needs you whenever a run waits for
 * the user, otherwise the last filter the user chose (Running before any choice).
 */
export function defaultRunsFilter({
  needsYouCount,
  lastChosen,
}: {
  needsYouCount: number;
  lastChosen: RunsFilterId | null;
}): RunsFilterId {
  if (needsYouCount > 0) return "needs-you";
  return lastChosen ?? "running";
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "5 minutes ago" style text for a row. Unparseable input is returned as is. */
export function formatRelativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const elapsed = Math.max(0, now - then);
  if (elapsed < 60_000) return "just now";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) {
      return formatter.format(-Math.floor(elapsed / size), unit);
    }
  }
  return "just now";
}
