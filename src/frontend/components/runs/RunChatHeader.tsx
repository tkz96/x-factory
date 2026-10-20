// src/frontend/components/runs/RunChatHeader.tsx — The run chat's header strip: the status pill, the
// elapsed time, the stage count (wide only), Expand all / Collapse all, and the phone details control.

import type { ReactNode } from "react";
import { TERMINAL_RUN_STATUSES } from "../../../shared/run-status-policy.js";
import type { Run, RunEvent } from "../../../shared/types.js";
import { useNow } from "../../hooks/useNow.js";
import {
  formatTook,
  type StageGroup,
  stagesDoneCount,
} from "../../lib/run-stages.js";
import {
  NEEDS_YOU_STATUSES,
  runStatusTone,
  runStatusUi,
} from "../../lib/run-status-ui.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";

interface RunChatHeaderProps {
  run: Run;
  events: RunEvent[];
  groups: StageGroup[];
  /** Phone width: the count is left out and the expand control is an icon. */
  narrow: boolean;
  allOpen: boolean;
  onToggleAll: () => void;
  /** At phone width, the control that opens the run details. */
  detailsTrigger?: ReactNode;
}

/**
 * Time since the run started. It ticks while the run is active; a finished or waiting run keeps
 * the time it stopped at (its last event), as the stepper did.
 */
function RunElapsed({
  startedAt,
  endedAt,
}: {
  startedAt: string;
  /** The moment the clock stops, or null while it runs. */
  endedAt: string | null;
}) {
  const tick = useNow(endedAt ? 60_000 : 1000);
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return null;
  const endMs = endedAt ? Date.parse(endedAt) : tick;
  return (
    <span className="run-chat-elapsed">
      {formatTook(Math.max(0, endMs - startMs))}
    </span>
  );
}

export function RunChatHeader({
  run,
  events,
  groups,
  narrow,
  allOpen,
  onToggleAll,
  detailsTrigger,
}: RunChatHeaderProps) {
  const ui = runStatusUi(run.status);
  // The header's clock stops at a finished run or one that waits on the reader.
  const waiting = NEEDS_YOU_STATUSES.has(run.status);
  const live = !TERMINAL_RUN_STATUSES.has(run.status) && !waiting;
  const lastEventAt = events.at(-1)?.timestamp ?? run.updatedAt;
  const expandLabel = allOpen ? "Collapse all" : "Expand all";

  return (
    <header className="run-panel-header run-chat-header">
      <Badge tone={runStatusTone(run.status)} className="run-chat-status">
        {waiting && <span className="run-chat-status-dot" aria-hidden="true" />}
        <span className="run-chat-status-label">
          {waiting ? "Needs you" : ui.label}
        </span>
      </Badge>
      <RunElapsed
        startedAt={run.startedAt}
        endedAt={live ? null : lastEventAt}
      />
      {/* At phone width the count is left out: the stage list says the same per stage. */}
      {!narrow && (
        <span className="run-chat-progress-count">
          {`${stagesDoneCount(groups)} of ${groups.length} stages done`}
        </span>
      )}
      {narrow ? (
        <IconButton
          label={expandLabel}
          icon="icon-chevron-right"
          variant="plain"
          className={
            allOpen
              ? "run-chat-expand-icon run-chat-expand-open"
              : "run-chat-expand-icon"
          }
          onPress={onToggleAll}
        />
      ) : (
        <Button variant="quiet" size="sm" onPress={onToggleAll}>
          {expandLabel}
        </Button>
      )}
      {detailsTrigger}
    </header>
  );
}
