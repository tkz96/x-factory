// src/frontend/components/MarkdownViewer.tsx — Safe, lightweight zero-dependency Markdown renderer for React 19.

import "./MarkdownViewer.css";

import { useState } from "react";

interface MarkdownViewerProps {
  content: string;
  onNavigateDoc?: (category: string, slug: string) => void;
}

interface CodeBlockProps {
  language: string;
  code: string;
}

function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

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
      <div className="md-code-header">
        <span>{language || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className={`md-copy-btn ${copied ? "copied" : ""}`}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre className="md-code-pre">
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
        <code key={`code-${idx}`} className="md-inline-code">
          {part.slice(1, -1)}
        </code>,
      );
      continue;
    }

    // Bold text: **text**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      elements.push(
        <strong key={`bold-${idx}`} className="md-bold">
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
      <h1 key={`h1-${index}`} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </h1>
    );
  }
  if (line.startsWith("## ")) {
    const raw = line.slice(3);
    return (
      <h2 key={`h2-${index}`} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </h2>
    );
  }
  if (line.startsWith("### ")) {
    const raw = line.slice(4);
    return (
      <h3 key={`h3-${index}`} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </h3>
    );
  }
  if (line.startsWith("#### ")) {
    const raw = line.slice(5);
    return (
      <h4 key={`h4-${index}`} id={headingSlug(raw)}>
        {renderInlineText(raw, onNavigateDoc)}
      </h4>
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
        <div className="md-alert-title">{alertType}</div>
        <div className="md-alert-body">{alertParagraphs}</div>
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
      <th key={`th-${hIdx}`}>{renderInlineText(h, onNavigateDoc)}</th>,
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
        <table className="table">
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

  return <div className="md-viewer markdown-content">{nodes}</div>;
}
