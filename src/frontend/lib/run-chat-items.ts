// src/frontend/lib/run-chat-items.ts — The run chat's one pure mapping (#261, spec #241).
//
// Every item in the run chat comes from a real run event through this function. Nothing is
// synthesised from the run's state: an unknown event type is dropped, and every item keeps
// its event's own time. Words for statuses come from the one status map (run-status-ui).

import type { DiffSummary } from "../../shared/diff-summary.js";
import type { FailureReason } from "../../shared/failure-reason.js";
import type { RunEvent, RunStatus, WorkflowStage } from "../../shared/types.js";
import { stageStartedText } from "./run-models.js";
import { runStatusText } from "./run-status-ui.js";
import { isWorkflowStage, stageDisplayLabel } from "./workflow-stages.js";

interface ItemBase {
  /** Stable across renders: `event-<id>`, so an item is announced once. */
  id: string;
  /** The event's own timestamp (ISO). */
  at: string;
}

/** The text of the notice for a pull request step that carries only a link. */
export const PULL_REQUEST_LINK_TEXT = "Pull request link";

export type ChatItem =
  | (ItemBase & {
      kind: "status";
      status: RunStatus;
      /** The status map's plain label, never the raw status string. */
      label: string;
      failure?: FailureReason | undefined;
    })
  | (ItemBase & { kind: "plan"; plan: string })
  | (ItemBase & { kind: "diff"; summary: DiffSummary })
  | (ItemBase & {
      kind: "review";
      tool?: string | undefined;
      text?: string | undefined;
    })
  | (ItemBase & {
      kind: "result";
      title: "Verification" | "Review";
      passed: boolean;
      summary: string;
    })
  | (ItemBase & {
      kind: "progress";
      iteration: number;
      text: string;
      /** True when the line before it was in the same iteration, so the number is not said again. */
      sameIteration?: boolean;
    })
  | (ItemBase & {
      kind: "output";
      speaker: "builder" | "reviewer";
      text: string;
    })
  | (ItemBase & { kind: "message"; role: "user" | "agent"; text: string })
  | (ItemBase & { kind: "evidence"; stage: string; text: string })
  | (ItemBase & {
      kind: "stage";
      text: string;
      stage?: WorkflowStage | undefined;
    })
  | (ItemBase & {
      kind: "notice";
      text: string;
      warning: boolean;
      url?: string | undefined;
    })
  | (ItemBase & { kind: "error"; text: string });

function base(event: RunEvent): ItemBase {
  return { id: `event-${event.id}`, at: event.timestamp };
}

/**
 * The items of each event, kept per event (#321): the same event object always gives the same item
 * objects, so a row whose event has not changed keeps its identity and does not render again.
 */
const itemsByEvent = new WeakMap<RunEvent, ChatItem[]>();

function mapEvent(event: RunEvent): ChatItem[] {
  let items = itemsByEvent.get(event);
  if (!items) {
    items = mapEventUncached(event);
    itemsByEvent.set(event, items);
  }
  return items;
}

function mapEventUncached(event: RunEvent): ChatItem[] {
  const common = base(event);
  switch (event.type) {
    case "status": {
      const { status, failure } = event.payload;
      return [
        {
          ...common,
          kind: "status",
          status,
          label: runStatusText(status),
          ...(failure ? { failure } : {}),
        },
      ];
    }
    case "plan_ready":
      return [{ ...common, kind: "plan", plan: event.payload.plan }];
    case "diff_summary":
      return [{ ...common, kind: "diff", summary: event.payload }];
    case "review_activity":
      return [
        {
          ...common,
          kind: "review",
          tool: event.payload.tool,
          text: event.payload.text,
        },
      ];
    case "verification":
      return [
        {
          ...common,
          kind: "result",
          title: "Verification",
          passed: event.payload.result.passed,
          summary: event.payload.result.summary,
        },
      ];
    case "review":
      return [
        {
          ...common,
          kind: "result",
          title: "Review",
          passed: event.payload.result.passed,
          summary: event.payload.result.summary,
        },
      ];
    case "ralph_progress":
      return [
        {
          ...common,
          kind: "progress",
          iteration: event.payload.iteration,
          text: event.payload.text,
        },
      ];
    case "pi_output_chunk":
      return [
        {
          ...common,
          kind: "output",
          speaker: event.payload.role === "reviewer" ? "reviewer" : "builder",
          text: event.payload.text,
        },
      ];
    case "chat_user":
      return [
        { ...common, kind: "message", role: "user", text: event.payload.text },
      ];
    case "user_feedback":
      return [
        { ...common, kind: "message", role: "user", text: event.payload.text },
      ];
    case "chat_agent":
      return [
        { ...common, kind: "message", role: "agent", text: event.payload.text },
      ];
    case "stage_evidence":
      return [
        {
          ...common,
          kind: "evidence",
          stage: stageDisplayLabel(event.payload.stage),
          text: event.payload.evidence,
        },
      ];
    case "stage_started": {
      // The review runs as a step of the execute stage on the worker, but the reader
      // follows it under Review, so a review step moves the timeline there.
      const stage =
        event.payload.step === "review" ? "review" : event.payload.stage;
      return [
        {
          ...common,
          kind: "stage",
          text: stageStartedText(event.payload),
          ...(isWorkflowStage(stage) ? { stage } : {}),
        },
      ];
    }
    case "pr_step": {
      const { url, text, step } = event.payload;
      const label = text ?? (url ? PULL_REQUEST_LINK_TEXT : step);
      return [
        {
          ...common,
          kind: "notice",
          text: label,
          warning: false,
          ...(url ? { url } : {}),
        },
      ];
    }
    case "info":
      return [
        {
          ...common,
          kind: "notice",
          text: event.payload.text,
          warning: event.payload.warning === "unsandboxed",
        },
      ];
    case "error":
      return [{ ...common, kind: "error", text: event.payload.message }];
    default:
      // A type this client does not know is ignored, never shown as invented text.
      return [];
  }
}

/**
 * Drops what the reader already saw: a status that repeats the status before it, an agent
 * output line that repeats the progress line before it (the loop logs each step both ways),
 * and a stage summary that restates the result before it ("Review approved: Review passed…").
 */
/** A progress item marked as continuing its iteration, kept per item so its identity is stable. */
const sameIterationOf = new WeakMap<ChatItem, ChatItem>();

function asSameIteration(item: ChatItem): ChatItem {
  let marked = sameIterationOf.get(item);
  if (!marked) {
    marked = { ...item, sameIteration: true } as ChatItem;
    sameIterationOf.set(item, marked);
  }
  return marked;
}

function withoutRepeats(items: readonly ChatItem[]): ChatItem[] {
  const kept: ChatItem[] = [];
  let lastStatus: RunStatus | undefined;
  let lastProgress: string | undefined;
  let lastResult: string | undefined;
  let lastIteration: number | undefined;
  for (const item of items) {
    if (item.kind === "status") {
      if (item.status === lastStatus && !item.failure) continue;
      lastStatus = item.status;
    }
    if (item.kind === "progress") {
      lastProgress = item.text.trim();
      const same = item.iteration === lastIteration;
      lastIteration = item.iteration;
      if (same) {
        kept.push(asSameIteration(item));
        continue;
      }
    }
    if (item.kind === "output" && item.text.trim() === lastProgress) continue;
    if (item.kind === "result") lastResult = item.summary.trim();
    if (
      item.kind === "evidence" &&
      lastResult &&
      item.text.includes(lastResult)
    ) {
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/** Maps a run's events, in order, to the chat's items. Pure: the same events always give the same items. */
export function mapEventsToChatItems(events: readonly RunEvent[]): ChatItem[] {
  return withoutRepeats(events.flatMap(mapEvent));
}
