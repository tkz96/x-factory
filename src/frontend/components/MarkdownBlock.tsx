// src/frontend/components/MarkdownBlock.tsx — Text that may be Markdown, shown the way a reader reads it
// (Preview) or the way its writer wrote it (Raw). The preview is the shared safe renderer, which never
// makes HTML from the source. Plain text has no toggle: it renders as the text it is.

import "./MarkdownBlock.css";

import { useState } from "react";
import { looksLikeMarkdown } from "../lib/markdown-syntax.js";
import { MarkdownScaleContext, MarkdownViewer } from "./MarkdownViewer.js";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "./ui/SegmentedControl.js";

export type MarkdownBlockView = "preview" | "raw";

export interface MarkdownBlockProps {
  content: string;
  /** A short name shown above the text, e.g. "Plan" or a stage name. */
  label?: string | undefined;
  /** The view shown first. Nothing is remembered between renders. */
  defaultView?: MarkdownBlockView | undefined;
  /** Smaller headings and tighter spacing, for text inside the run chat. */
  compact?: boolean | undefined;
  className?: string | undefined;
}

const VIEW_OPTIONS: readonly SegmentedControlOption[] = [
  { id: "preview", label: "Preview" },
  { id: "raw", label: "Raw" },
];

export function MarkdownBlock({
  content,
  label,
  defaultView = "preview",
  compact = false,
  className,
}: MarkdownBlockProps) {
  const [view, setView] = useState<MarkdownBlockView>(defaultView);
  const markdown = looksLikeMarkdown(content);
  const classes = ["md-block"];
  if (compact) classes.push("md-block-compact");
  if (className !== undefined) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      {(label !== undefined || markdown) && (
        <div className="md-block-header">
          {label !== undefined && (
            <span className="md-block-label text-footnote font-semibold">
              {label}
            </span>
          )}
          {markdown && (
            <SegmentedControl
              label="Text view"
              value={view}
              onChange={(id) => setView(id === "raw" ? "raw" : "preview")}
              options={VIEW_OPTIONS}
              className="md-block-toggle text-caption-1"
            />
          )}
        </div>
      )}
      {!markdown ? (
        <p className="md-block-plain">{content}</p>
      ) : view === "raw" ? (
        <pre className="md-block-raw text-caption-1">{content}</pre>
      ) : (
        <div className="md-block-preview">
          <MarkdownScaleContext.Provider value={compact ? "compact" : "block"}>
            <MarkdownViewer content={content} />
          </MarkdownScaleContext.Provider>
        </div>
      )}
    </div>
  );
}
