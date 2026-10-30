// src/frontend/lib/run-stages.ts — The run's six stages: their order and labels, and how the run
// chat's items group under them (spec "Item -> stage assignment", "Stage timing", "Stage status").
// Pure: the same items, run and events always give the same groups.

import {
  STATUS_TO_STAGE,
  TERMINAL_RUN_STATUSES,
} from "../../shared/run-status-policy.js";
import type { Run, RunEvent, WorkflowStage } from "../../shared/types.js";
import type { ChatItem } from "./run-chat-items.js";
import { STAGE_LABELS, STAGE_ORDER } from "./workflow-stages.js";

export type StageState = "done" | "current" | "upcoming" | "failed" | "stopped";

export interface StageGroup {
  stage: WorkflowStage;
  label: string;
  state: StageState;
  items: ChatItem[];
  /** The time of the stage's first item, or null when it has none. */
  startedAt: string | null;
  /** Start of the next stage that has items; for a terminal run, its terminal status. Null while current. */
  endedAt: string | null;
  /** endedAt - startedAt, or null when either is unknown. */
  tookMs: number | null;
}

export function formatTook(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (hours > 0) return `${hours}h ${min}m`;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

/** How many stages are done: the count the run page's header reads as "N of 6". */
export function stagesDoneCount(groups: readonly StageGroup[]): number {
  return groups.filter((group) => group.state === "done").length;
}

/**
 * Groups a run's chat items under the six stages, in order. A status item moves the stage to its
 * own stage (a null stage keeps the previous one); a stage item moves it to the stage it names;
 * every other item belongs to the current stage; items before any stage go to prepare. Notices
 * just before a stage item announce it ("Conducting automated code review…"), so they move with it.
 */
export function groupItemsByStage(
  items: readonly ChatItem[],
  run: Pick<Run, "status">,
  _events: readonly RunEvent[],
): StageGroup[] {
  return buildGroups(items, run, null);
}

/** One try at the work: the first run through the stages, or the stages after a rework. */
export interface Attempt {
  /** 1 for the first attempt. */
  number: number;
  /** The stage whose status moved the run back; null for attempt 1. */
  reworkedFrom: WorkflowStage | null;
  /** "Attempt 2 · Reworked from Review", or "Attempt 1". */
  label: string;
  /** The stages of this attempt. Earlier attempts show only stages with items. */
  groups: StageGroup[];
}

/**
 * Splits a run's items into attempts. A status that moves the run back to an earlier stage (a
 * rework) starts a new attempt at that stage. Earlier attempts are settled: every stage is done
 * and the last one ends where the next attempt starts. The latest attempt carries the run's state.
 */
export function groupAttempts(
  items: readonly ChatItem[],
  run: Pick<Run, "status">,
  events: readonly RunEvent[],
): Attempt[] {
  const segments: { from: WorkflowStage | null; items: ChatItem[] }[] = [
    { from: null, items: [] },
  ];
  let walked: WorkflowStage = "prepare";
  for (const item of items) {
    if (item.kind === "status") {
      const stage = STATUS_TO_STAGE[item.status];
      if (stage && STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(walked)) {
        segments.push({ from: walked, items: [] });
      }
      walked = stage ?? walked;
    } else if (item.kind === "stage" && item.stage) {
      walked = item.stage;
    }
    segments.at(-1)?.items.push(item);
  }

  if (segments.length === 1) {
    return [
      {
        number: 1,
        reworkedFrom: null,
        label: "Attempt 1",
        groups: groupItemsByStage(items, run, events),
      },
    ];
  }

  return segments.map((segment, index) => {
    const isLatest = index === segments.length - 1;
    const next = segments[index + 1];
    let groups = isLatest
      ? buildGroups(segment.items, run, null)
      : buildGroups(segment.items, run, { endAt: next?.items[0]?.at ?? null });
    if (isLatest) {
      const first = segment.items.find((i) => i.kind === "status");
      const start =
        first?.kind === "status" ? STATUS_TO_STAGE[first.status] : null;
      const startIdx = start ? STAGE_ORDER.indexOf(start) : 0;
      groups = groups.filter((g) => STAGE_ORDER.indexOf(g.stage) >= startIdx);
    } else {
      groups = groups.filter((g) => g.items.length > 0);
    }
    const reworkedFrom = segment.from;
    return {
      number: index + 1,
      reworkedFrom,
      label: reworkedFrom
        ? `Attempt ${index + 1} · Reworked from ${STAGE_LABELS[reworkedFrom]}`
        : `Attempt ${index + 1}`,
      groups,
    };
  });
}

/**
 * The stage groups of one run of items. With `settled`, the items are an earlier attempt: every
 * stage is done and the last one ends at `endAt`.
 */
function buildGroups(
  items: readonly ChatItem[],
  run: Pick<Run, "status">,
  settled: { endAt: string | null } | null,
): StageGroup[] {
  // 1. Assign each item to a stage, walking in order.
  const buckets = new Map<WorkflowStage, ChatItem[]>(
    STAGE_ORDER.map((stage) => [stage, []]),
  );
  let walked: WorkflowStage = "prepare";
  for (const item of items) {
    if (item.kind === "status") {
      walked = STATUS_TO_STAGE[item.status] ?? walked;
    } else if (item.kind === "stage" && item.stage && item.stage !== walked) {
      const left = buckets.get(walked) ?? [];
      const announced: ChatItem[] = [];
      while (left.at(-1)?.kind === "notice") {
        announced.unshift(left.pop() as ChatItem);
      }
      walked = item.stage;
      buckets.get(walked)?.push(...announced);
    }
    buckets.get(walked)?.push(item);
  }

  // 2. Where the run stands. A failed or stopped run stands in the stage it left.
  const { status } = run;
  const terminal = settled !== null || TERMINAL_RUN_STATUSES.has(status);
  const delivered = settled !== null || status === "pr_created";
  const endState: StageState | null =
    status === "failed" ? "failed" : status === "stopped" ? "stopped" : null;
  // Where the run stands: the stage its items reached, or its status's stage when that is
  // later. The walk sees steps the status does not (a review runs while the status still
  // says executing), and a failed or stopped status names no stage, so the walk holds the
  // stage the run left.
  let position: WorkflowStage = walked;
  if (!endState && !delivered) {
    const byStatus = STATUS_TO_STAGE[status] ?? walked;
    if (STAGE_ORDER.indexOf(byStatus) > STAGE_ORDER.indexOf(walked)) {
      position = byStatus;
    }
  }
  const positionIdx = STAGE_ORDER.indexOf(position);

  // 3. Start times, and the end of a terminal run's last stage.
  const starts = STAGE_ORDER.map(
    (stage) => buckets.get(stage)?.[0]?.at ?? null,
  );
  // A terminal run ends at its terminal status. Later events (a merge, a close) do not extend it.
  const terminalStatusItem = items.findLast(
    (item) => item.kind === "status" && TERMINAL_RUN_STATUSES.has(item.status),
  );
  const terminalEnd = settled
    ? (settled.endAt ?? items.at(-1)?.at ?? null)
    : terminal
      ? (terminalStatusItem?.at ?? items.at(-1)?.at ?? null)
      : null;

  return STAGE_ORDER.map((stage, idx) => {
    let state: StageState;
    if (delivered) state = "done";
    else if (idx === positionIdx) state = endState ?? "current";
    else state = idx < positionIdx ? "done" : "upcoming";

    const startedAt = starts[idx] ?? null;
    let endedAt: string | null = null;
    if (startedAt && state !== "current") {
      const nextStart = starts.slice(idx + 1).find((s) => s !== null) ?? null;
      endedAt = nextStart ?? (terminal ? terminalEnd : null);
    }
    const tookMs =
      startedAt && endedAt
        ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
        : null;

    return {
      stage,
      label: STAGE_LABELS[stage],
      state,
      items: buckets.get(stage) ?? [],
      startedAt,
      endedAt,
      tookMs,
    };
  });
}
