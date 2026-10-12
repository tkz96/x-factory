// src/frontend/components/runs/RunInspector.tsx — The run inspector (#262, spec #241): evidence, the
// files the run changed, and the raw activity log. Beside the chat on a wide window; a sheet at
// phone width. It shows details on request and never competes with the chat for attention.

import "./RunInspector.css";

import { useState } from "react";
import { summarizeDiff } from "../../../shared/diff-summary.js";
import type { Run, RunEvent } from "../../../shared/types.js";
import { Sheet } from "../overlays/index.js";
import { Button } from "../ui/Button.js";
import { ChatThread } from "./ChatThread.js";
import { RunEvidence } from "./RunEvidence.js";

export interface RunInspectorProps {
  run: Run;
  events: RunEvent[];
  connected: boolean;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function InspectorBody({ run, events, connected }: RunInspectorProps) {
  const summary = summarizeDiff(run.diff);
  return (
    <>
      <section
        className="run-inspector-section"
        aria-labelledby="inspector-evidence"
      >
        <h3 id="inspector-evidence">Evidence</h3>
        <RunEvidence run={run} />
      </section>

      <section
        className="run-inspector-section"
        aria-labelledby="inspector-files"
      >
        <h3 id="inspector-files">Files</h3>
        {summary.files.length === 0 ? (
          <p className="run-inspector-empty">No changes yet.</p>
        ) : (
          <>
            <p className="run-inspector-empty">
              {`${summary.files.length} ${plural(summary.files.length, "file", "files")} · +${summary.totalAdded} −${summary.totalRemoved}`}
            </p>
            <ul className="run-inspector-files">
              {summary.files.map((file) => (
                <li key={file.path} className="run-inspector-file">
                  <span className="run-inspector-file-path">{file.path}</span>
                  <span className="run-inspector-file-counts">
                    {`+${file.added} −${file.removed}`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section
        className="run-inspector-section"
        aria-labelledby="inspector-log"
      >
        <h3 id="inspector-log">
          Raw log
          {connected && (
            <span
              className="run-inspector-stream-dot"
              title="Live stream connected"
            />
          )}
          <span
            className="run-inspector-count"
            role="note"
            aria-label={`${events.length} ${plural(events.length, "event", "events")}`}
          >
            {events.length}
          </span>
        </h3>
        <div className="run-inspector-scroll">
          <ChatThread events={events} />
        </div>
      </section>
    </>
  );
}

/** The inspector beside the chat, for a wide window. */
export function RunInspector(props: RunInspectorProps) {
  return (
    <aside className="run-inspector" aria-label="Inspector">
      <InspectorBody {...props} />
    </aside>
  );
}

/** The inspector at phone width: a button that opens it as a sheet. */
export function RunInspectorSheet(props: RunInspectorProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onPress={() => setOpen(true)}>
        Inspector
      </Button>
      <Sheet
        isOpen={open}
        onClose={() => setOpen(false)}
        position="bottom"
        id="run-inspector-sheet"
        ariaLabel="Inspector"
        className="run-inspector-sheet"
      >
        <div className="run-inspector run-inspector-in-sheet">
          <InspectorBody {...props} />
        </div>
      </Sheet>
    </>
  );
}
