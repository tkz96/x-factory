// src/frontend/components/runs/RunSplitHandle.tsx — The vertical divider between the run page's chat
// panel and its "Run details" pane (desktop only). Drag it with a pointer, or focus it and use the
// arrow keys; Home and End jump to the limits, and Enter or a double-click restores the default.

import "./RunSplitHandle.css";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useState,
} from "react";
import {
  RUN_SPLIT_DEFAULT,
  RUN_SPLIT_MAX,
  RUN_SPLIT_MIN,
} from "./useRunSplit.js";

/** One arrow press moves the divider this many percent. */
const KEY_STEP = 5;
/** The attribute on the layout while a drag runs: it stops text selection across the page. */
const RESIZING_ATTR = "data-resizing";

export interface RunSplitHandleProps {
  /** The layout that holds both panels; its bounds set the percentage a pointer position means. */
  containerRef: RefObject<HTMLElement | null>;
  split: number;
  onSplit: (percent: number) => void;
  onReset: () => void;
}

/** The percentage of the layout's width that lies left of a pointer position. */
function percentAt(container: HTMLElement, clientX: number): number {
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0) return RUN_SPLIT_DEFAULT;
  return ((clientX - rect.left) / rect.width) * 100;
}

/** The split a key asks for, or null when the key is not one of the divider's keys. */
function splitForKey(key: string, split: number): number | null {
  switch (key) {
    case "ArrowLeft":
      return split - KEY_STEP;
    case "ArrowRight":
      return split + KEY_STEP;
    case "Home":
      return RUN_SPLIT_MIN;
    case "End":
      return RUN_SPLIT_MAX;
    default:
      return null;
  }
}

export function RunSplitHandle({
  containerRef,
  split,
  onSplit,
  onReset,
}: RunSplitHandleProps) {
  const [dragging, setDragging] = useState(false);

  const setResizing = (on: boolean) => {
    const container = containerRef.current;
    if (!container) return;
    if (on) container.setAttribute(RESIZING_ATTR, "");
    else container.removeAttribute(RESIZING_ATTR);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setResizing(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!dragging || !container) return;
    onSplit(percentAt(container, event.clientX));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setResizing(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onReset();
      return;
    }
    const next = splitForKey(event.key, split);
    if (next === null) return;
    event.preventDefault();
    onSplit(next);
  };

  const classes = ["run-split-handle"];
  if (dragging) classes.push("run-split-handle--dragging");

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter is the ARIA separator role; <hr> is not interactive
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      aria-valuemin={RUN_SPLIT_MIN}
      aria-valuemax={RUN_SPLIT_MAX}
      aria-valuenow={Math.round(split)}
      tabIndex={0}
      className={classes.join(" ")}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
    >
      <span className="run-split-handle-grip" aria-hidden="true" />
    </div>
  );
}
