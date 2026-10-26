// src/frontend/lib/run-chat-rows.ts — Folds a run's chat items into the rows the chat draws: runs of
// agent updates (the Builder's progress and output, the Reviewer's tool calls and report) become one
// group the reader can open (#261). Pure, so the run chat and the
// stage timeline share one rule without importing each other.

import type { ChatItem } from "./run-chat-items.js";

/** Runs of progress lines this long fold into one group the reader can open (#261). */
const GROUP_MIN = 3;

export type Row =
  | { kind: "item"; item: ChatItem }
  | { kind: "group"; id: string; items: ChatItem[] };

/** Folds consecutive agent updates into groups; every other item is its own row. */
export function groupRows(items: readonly ChatItem[]): Row[] {
  const rows: Row[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    if (run.length >= GROUP_MIN) {
      rows.push({ kind: "group", id: `group-${run[0]?.id ?? ""}`, items: run });
    } else {
      for (const item of run) rows.push({ kind: "item", item });
    }
    run = [];
  };
  for (const item of items) {
    if (
      item.kind === "progress" ||
      item.kind === "output" ||
      item.kind === "review"
    ) {
      run.push(item);
    } else {
      flush();
      rows.push({ kind: "item", item });
    }
  }
  flush();
  return rows;
}
