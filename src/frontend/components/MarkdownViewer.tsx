// src/frontend/components/MarkdownViewer.tsx — Safe, lightweight zero-dependency Markdown renderer for React 19.

import "./MarkdownViewer.css";

import { createContext, type ReactNode, useContext, useState } from "react";
import { FlowDiagramViewer } from "./diagrams/FlowDiagramViewer.js";
import { Button } from "./ui/Button.js";

interface MarkdownViewerProps {
  content: string;
  onNavigateDoc?: (category: string, slug: string) => void;
}

interface CodeBlockProps {
  language: string;
  code: string;
}

/**
 * The text scale of the Markdown on screen. `page` is the reading page; `block`
 * and `compact` are the preview inside a MarkdownBlock, which inherits its
 * container's size and shrinks its headings. Text styles are set in markup, so
 * the scale reaches the elements through this context, not through CSS.
 */
export type MarkdownScale = "page" | "block" | "compact";
export const MarkdownScaleContext = createContext<MarkdownScale>("page");

const HEADING_TEXT: Record<MarkdownScale, Record<1 | 2 | 3 | 4, string>> = {
  page: {
    1: "text-title-1 font-bold",
    2: "text-title-3 font-semibold",
    3: "text-headline font-semibold",
    4: "text-subhead font-semibold",
  },
  block: {
    1: "text-headline font-semibold",
    2: "text-subhead font-semibold",
    3: "text-title-3 font-semibold",
    4: "text-footnote font-semibold",
  },
  compact: {
    1: "text-subhead font-semibold",
    2: "text-subhead font-semibold",
    3: "text-headline font-semibold",
    4: "text-footnote font-semibold",
  },
};

function MarkdownHeading({
  level,
  id,
  children,
}: {
  level: 1 | 2 | 3 | 4;
  id: string;
  children: ReactNode;
}) {
  const scale = useContext(MarkdownScaleContext);
  const className = HEADING_TEXT[scale][level];
  if (level === 1)
    return (
      <h1 id={id} className={className}>
        {children}
      </h1>
    );
  if (level === 2)
    return (
      <h2 id={id} className={className}>
        {children}
      </h2>
    );
  if (level === 3)
    return (
      <h3 id={id} className={className}>
        {children}
      </h3>
    );
  return (
    <h4 id={id} className={className}>
      {children}
    </h4>
  );
}

function MarkdownInlineCode({ children }: { children: ReactNode }) {
  const scale = useContext(MarkdownScaleContext);
  return (
    <code
      className={`md-inline-code ${scale === "page" ? "text-footnote" : "text-caption-1"}`}
    >
      {children}
    </code>
  );
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const scale = useContext(MarkdownScaleContext);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  return (
    <div className="md-code-container">
      <div className="md-code-header text-caption-1">
        <span>{language || "text"}</span>
        <Button
          variant="quiet"
          size="sm"
          onPress={handleCopy}
          className={`md-copy-btn ${copied ? "copied" : ""}`}
        >
          {copied ? "✓ Copied" : "Copy"}
        </Button>
      </div>
      <pre
        className={`md-code-pre ${scale === "page" ? "text-footnote" : "text-caption-1"}`}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Parses inline formatting: bold, inline code, and links.
 */
function renderInlineText(
  text: string,
  onNavigateDoc?: (category: string, slug: string) => void,
): React.ReactNode[] {
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(tokenRegex);
  const elements: React.ReactNode[] = [];

  for (let idx = 0; idx < parts.length; idx++) {
    const part = parts[idx];
    if (!part) continue;

    // Inline code: `code`
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      elements.push(
        <MarkdownInlineCode key={`code-${idx}`}>
          {part.slice(1, -1)}
        </MarkdownInlineCode>,
      );
      continue;
    }

    // Bold text: **text**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      elements.push(
        <strong key={`bold-${idx}`} className="md-bold font-semibold">
          {part.slice(2, -2)}
        </strong>,
      );
      continue;
    }

    // Links: [Label](URL)
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const label = linkMatch[1] ?? "";
      const url = linkMatch[2] ?? "";

      const docMatch = url.match(/docs\/([a-z0-9_-]+)\/([a-z0-9_-]+)\.md/i);
      if (docMatch && onNavigateDoc) {
        const cat = docMatch[1] ?? "";
        const slug = docMatch[2] ?? "";
        elements.push(
          <a
            key={`doclink-${idx}`}
            href={`#${cat}/${slug}`}
            onClick={(e) => {
              e.preventDefault();
              onNavigateDoc(cat, slug);
            }}
            className="md-doc-link"
          >
            {label}
          </a>,
        );
        continue;
      }

      const isExternal =
        url.startsWith("http://") || url.startsWith("https://");
      elements.push(
        <a
          key={`link-${idx}`}
          href={url}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="md-link"
        >
          {label}
        </a>,
      );
      continue;
    }

    elements.push(<span key={`text-${idx}`}>{part}</span>);
  }

  return elements;
}

function renderListBlock(
  items: string[],
  ordered: boolean,
  keyIndex: number,
  onNavigateDoc?: (category: string, slug: string) => void,
): React.ReactNode {
  const children: React.ReactNode[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const itm = items[idx] ?? "";
    children.push(
      <li key={`item-${idx}`}>{renderInlineText(itm, onNavigateDoc)}</li>,
    );
  }

  return ordered ? (
    <ol key={`ol-${keyIndex}`} className="md-list">
      {children}
    </ol>
  ) : (
    <ul key={`ul-${keyIndex}`} className="md-list">
      {children}
    </ul>
  );
}

function parseListItems(
  lines: string[],
  startIndex: number,
  regex: RegExp,
): { items: string[]; nextIndex: number } {
  const items: string[] = [];
  let idx = startIndex;
  while (idx < lines.length) {
    const current = lines[idx];
    if (current === undefined || !regex.test(current.trim())) {
      break;
    }
    items.push(current.trim().replace(regex, ""));
    idx++;
  }
  return { items, nextIndex: idx };
}

function parseFencedCode(
  lines: string[],
  startIndex: number,
): { node: React.ReactNode; nextIndex: number } | null {
  const firstLine = lines[startIndex];
  if (!firstLine?.trim().startsWith("```")) {
    return null;
  }
  const language = firstLine.trim().slice(3).trim();
  const codeLines: string[] = [];
  let idx = startIndex + 1;
  while (idx < lines.length) {
    const current = lines[idx];
    if (current === undefined || current.trim().startsWith("```")) {
      break;
    }
    codeLines.push(current);
    idx++;
  }
  idx++; // Skip closing ```

  if (language.startsWith("diagram:")) {
    const diagramId = language.slice(8).trim();
    return {
      node: <FlowDiagramViewer key={`diagram-${idx}`} diagramId={diagramId} />,
      nextIndex: idx,
    };
  }

  return {
    node: (
      <CodeBlock
        key={`code-${idx}`}
        language={language}
        code={codeLines.join("\n")}
      />
    ),
    nextIndex: idx,
  };
}

function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*`_#]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseHeading(
  line: string,
  index: number,
  onNavigateDoc?: (category: string, slug: string) => void,
): React.ReactNode | null {
  if (line.startsWith("# ")) {
    const raw = line.slice(2);
    return (
      <MarkdownHeading key={`h1-${index}`} level={1} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </MarkdownHeading>
    );
  }
  if (line.startsWith("## ")) {
    const raw = line.slice(3);
    return (
      <MarkdownHeading key={`h2-${index}`} level={2} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </MarkdownHeading>
    );
  }
  if (line.startsWith("### ")) {
    const raw = line.slice(4);
    return (
      <MarkdownHeading key={`h3-${index}`} level={3} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </MarkdownHeading>
    );
  }
  if (line.startsWith("#### ")) {
    const raw = line.slice(5);
    return (
      <MarkdownHeading key={`h4-${index}`} level={4} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </MarkdownHeading>
    );
  }
  return null;
}

function getAlertClass(alertType: string): string {
  const lower = alertType.toLowerCase();
  if (lower === "tip") return "md-alert-tip";
  if (lower === "warning" || lower === "important") return "md-alert-warning";
  if (lower === "caution") return "md-alert-caution";
  return "md-alert-note";
}

function parseAlertBlock(
  lines: string[],
  startIndex: number,
  onNavigateDoc?: (category: string, slug: string) => void,
): { node: React.ReactNode; nextIndex: number } | null {
  const firstLine = lines[startIndex];
  if (!firstLine?.trim().startsWith("> [!")) {
    return null;
  }
  const alertTypeMatch = firstLine
    .trim()
    .match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
  const alertType = (alertTypeMatch?.[1] ?? "NOTE").toUpperCase();
  const alertLines: string[] = [];
  let idx = startIndex + 1;
  while (idx < lines.length) {
    const current = lines[idx];
    if (current === undefined || !current.trim().startsWith(">")) {
      break;
    }
    alertLines.push(current.replace(/^>\s?/, ""));
    idx++;
  }

  const alertParagraphs: React.ReactNode[] = [];
  for (let lineIdx = 0; lineIdx < alertLines.length; lineIdx++) {
    const l = alertLines[lineIdx] ?? "";
    alertParagraphs.push(
      <p key={`alertline-${lineIdx}`} className="md-alert-line">
        {renderInlineText(l, onNavigateDoc)}
      </p>,
    );
  }

  return {
    node: (
      <div
        key={`alert-${idx}`}
        className={`md-alert ${getAlertClass(alertType)}`}
      >
        <div className="md-alert-title text-caption-1 font-bold">
          {alertType}
        </div>
        <div className="md-alert-body text-subhead">{alertParagraphs}</div>
      </div>
    ),
    nextIndex: idx,
  };
}

function parseBlockquote(
  lines: string[],
  startIndex: number,
  onNavigateDoc?: (category: string, slug: string) => void,
): { node: React.ReactNode; nextIndex: number } | null {
  const firstLine = lines[startIndex];
  if (!firstLine?.trim().startsWith(">")) {
    return null;
  }
  const quoteLines: string[] = [];
  let idx = startIndex;
  while (idx < lines.length) {
    const current = lines[idx];
    if (current === undefined || !current.trim().startsWith(">")) {
      break;
    }
    quoteLines.push(current.replace(/^>\s?/, ""));
    idx++;
  }

  const quoteParagraphs: React.ReactNode[] = [];
  for (let qIdx = 0; qIdx < quoteLines.length; qIdx++) {
    const ql = quoteLines[qIdx] ?? "";
    quoteParagraphs.push(
      <p key={`quoteline-${qIdx}`} className="md-quote-line">
        {renderInlineText(ql, onNavigateDoc)}
      </p>,
    );
  }

  return {
    node: <blockquote key={`quote-${idx}`}>{quoteParagraphs}</blockquote>,
    nextIndex: idx,
  };
}

function parseTable(
  lines: string[],
  startIndex: number,
  onNavigateDoc?: (category: string, slug: string) => void,
): { node: React.ReactNode; nextIndex: number } | null {
  const firstLine = lines[startIndex];
  if (!firstLine?.trim().startsWith("|") || !firstLine.trim().endsWith("|")) {
    return null;
  }
  const tableRows: string[][] = [];
  let idx = startIndex;
  while (idx < lines.length) {
    const current = lines[idx];
    if (current === undefined || !current.trim().startsWith("|")) {
      break;
    }
    const rawRow = current.trim();
    if (!/^[|\s:-]+$/.test(rawRow)) {
      const cells = rawRow
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
    }
    idx++;
  }

  const headers = tableRows[0];
  const rows = tableRows.slice(1);
  if (!headers || headers.length === 0) {
    return null;
  }

  const headerElements: React.ReactNode[] = [];
  for (let hIdx = 0; hIdx < headers.length; hIdx++) {
    const h = headers[hIdx] ?? "";
    headerElements.push(
      <th key={`th-${hIdx}`} className="text-caption-1 font-semibold">
        {renderInlineText(h, onNavigateDoc)}
      </th>,
    );
  }

  const rowElements: React.ReactNode[] = [];
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx] ?? [];
    const cellElements: React.ReactNode[] = [];
    for (let cIdx = 0; cIdx < r.length; cIdx++) {
      const c = r[cIdx] ?? "";
      cellElements.push(
        <td key={`td-${rIdx}-${cIdx}`}>
          {renderInlineText(c, onNavigateDoc)}
        </td>,
      );
    }
    rowElements.push(<tr key={`tr-${rIdx}`}>{cellElements}</tr>);
  }

  return {
    node: (
      <div key={`table-${idx}`} className="md-table-container">
        <table className="table text-footnote">
          <thead>
            <tr>{headerElements}</tr>
          </thead>
          <tbody>{rowElements}</tbody>
        </table>
      </div>
    ),
    nextIndex: idx,
  };
}

function parseParagraph(
  lines: string[],
  startIndex: number,
  onNavigateDoc?: (category: string, slug: string) => void,
): { node: React.ReactNode; nextIndex: number } | null {
  const paragraphLines: string[] = [];
  let idx = startIndex;
  while (idx < lines.length) {
    const current = lines[idx];
    if (
      current === undefined ||
      !current.trim() ||
      current.startsWith("#") ||
      current.trim().startsWith("```") ||
      current.trim().startsWith(">") ||
      current.trim().startsWith("|") ||
      /^[-*]\s+/.test(current.trim()) ||
      /^\d+\.\s+/.test(current.trim()) ||
      /^(\*{3,}|-{3,}|_{3,})$/.test(current.trim())
    ) {
      break;
    }
    paragraphLines.push(current);
    idx++;
  }

  if (paragraphLines.length === 0) {
    return null;
  }

  return {
    node: (
      <p key={`p-${idx}`}>
        {renderInlineText(paragraphLines.join(" "), onNavigateDoc)}
      </p>
    ),
    nextIndex: idx,
  };
}

export function MarkdownViewer({
  content,
  onNavigateDoc,
}: MarkdownViewerProps) {
  const scale = useContext(MarkdownScaleContext);
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined || !line.trim()) {
      i++;
      continue;
    }

    const code = parseFencedCode(lines, i);
    if (code) {
      nodes.push(code.node);
      i = code.nextIndex;
      continue;
    }

    const heading = parseHeading(line, i, onNavigateDoc);
    if (heading) {
      nodes.push(heading);
      i++;
      continue;
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      nodes.push(<hr key={`hr-${i}`} />);
      i++;
      continue;
    }

    const alert = parseAlertBlock(lines, i, onNavigateDoc);
    if (alert) {
      nodes.push(alert.node);
      i = alert.nextIndex;
      continue;
    }

    const quote = parseBlockquote(lines, i, onNavigateDoc);
    if (quote) {
      nodes.push(quote.node);
      i = quote.nextIndex;
      continue;
    }

    const table = parseTable(lines, i, onNavigateDoc);
    if (table) {
      nodes.push(table.node);
      i = table.nextIndex;
      continue;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      const { items, nextIndex } = parseListItems(lines, i, /^[-*]\s+/);
      i = nextIndex;
      nodes.push(renderListBlock(items, false, i, onNavigateDoc));
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const { items, nextIndex } = parseListItems(lines, i, /^\d+\.\s+/);
      i = nextIndex;
      nodes.push(renderListBlock(items, true, i, onNavigateDoc));
      continue;
    }

    const paragraph = parseParagraph(lines, i, onNavigateDoc);
    if (paragraph) {
      nodes.push(paragraph.node);
      i = paragraph.nextIndex;
      continue;
    }

    i++;
  }

  return (
    <div
      className={`md-viewer markdown-content${scale === "page" ? " text-body" : ""}`}
    >
      {nodes}
    </div>
  );
}
