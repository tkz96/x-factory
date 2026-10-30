// src/frontend/components/MarkdownBlock.tsx — Text that may be Markdown, shown the way a reader reads it
// (Preview) or the way its writer wrote it (Raw). The preview is the shared safe renderer, which never
// makes HTML from the source. Plain text has no toggle: it renders as the text it is.

import "./MarkdownBlock.css";

import { useLayoutEffect, useRef, useState } from "react";
import { looksLikeMarkdown } from "../lib/markdown-syntax.js";
import { MarkdownScaleContext, MarkdownViewer } from "./MarkdownViewer.js";
import { Button } from "./ui/Button.js";
import { CopyButton } from "./ui/CopyButton.js";
import {
  SegmentedControl,
  type SegmentedControlOption,
} from "./ui/SegmentedControl.js";
import { useMediaQuery } from "./ui/useMediaQuery.js";

const PHONE_QUERY = "(max-width: 768px)";

export type MarkdownBlockView = "preview" | "raw";

export interface MarkdownBlockProps {
  content: string;
  /** A short name shown above the text, e.g. "Plan" or a stage name. */
  label?: string | undefined;
  /** The view shown first. Nothing is remembered between renders. */
  defaultView?: MarkdownBlockView | undefined;
  /** Smaller headings and tighter spacing, for text inside the run chat. */
  compact?: boolean | undefined;
  /**
   * For long text in a card: the preview scrolls with a fade at its edge, and at phone width it is
   * folded with a "Show All" control, so the full text is one press away.
   */
  foldable?: boolean | undefined;
  className?: string | undefined;
}

const VIEW_OPTIONS: readonly SegmentedControlOption[] = [
  { id: "preview", label: "Preview", icon: "icon-eye", iconOnly: true },
  { id: "raw", label: "Raw", icon: "icon-code", iconOnly: true },
];

export function MarkdownBlock({
  content,
  label,
  defaultView = "preview",
  compact = false,
  foldable = false,
  className,
}: MarkdownBlockProps) {
  const [view, setView] = useState<MarkdownBlockView>(defaultView);
  const [expanded, setExpanded] = useState(false);
  const phone = useMediaQuery(foldable ? PHONE_QUERY : "");
  const folded = foldable && phone && !expanded;
  const previewRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  // The fade is drawn only while the text is cut off at the bottom edge.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the size changes with these inputs
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [content, view, folded, expanded, phone]);
  const markdown = looksLikeMarkdown(content);
  const classes = ["md-block"];
  if (compact) classes.push("md-block-compact");
  if (foldable) classes.push("md-block-foldable");
  if (folded) classes.push("md-block-folded");
  if (foldable && overflows && !(phone && expanded)) {
    classes.push("md-block-fade");
  }
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
          <div className="md-block-tools">
            {markdown && (
              <SegmentedControl
                label="Text view"
                value={view}
                onChange={(id) => setView(id === "raw" ? "raw" : "preview")}
                options={VIEW_OPTIONS}
                className="md-block-toggle"
              />
            )}
            <CopyButton
              text={content}
              label={label === undefined ? "Copy Text" : `Copy ${label}`}
            />
          </div>
        </div>
      )}
      {!markdown ? (
        <p className="md-block-plain">{content}</p>
      ) : view === "raw" ? (
        <pre className="md-block-raw text-caption-1">{content}</pre>
      ) : (
        <div className="md-block-preview" ref={previewRef}>
          <MarkdownScaleContext.Provider value={compact ? "compact" : "block"}>
            <MarkdownViewer content={content} />
          </MarkdownScaleContext.Provider>
        </div>
      )}
      {foldable && phone && markdown && view === "preview" && (
        <Button
          variant="quiet"
          size="sm"
          className="md-block-fold"
          aria-expanded={expanded}
          onPress={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show Less" : "Show All"}
        </Button>
      )}
    </div>
  );
}
