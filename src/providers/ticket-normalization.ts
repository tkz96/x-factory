// src/providers/ticket-normalization.ts — Ticket normalization module (#185).
//
// Single source of truth for turning ticket text into acceptance criteria.
// Adapters only convert their provider-specific format to text (HTML for Azure,
// ADF for Jira, Markdown for GitHub).

export { DEFAULT_PAGE_CAP } from "./http.js";

/**
 * Returns true if a line represents an acceptance criteria section heading.
 * Handles markdown prefixes (#+), trailing colons, and markdown styling (*, _).
 */
export function isSectionHeader(line: string): boolean {
  const stripped = line.replace(/[*_]/g, "").trim();
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(
    stripped,
  );
}

/**
 * Returns true if any line in the text represents an acceptance criteria heading.
 */
export function hasSectionHeader(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.some(isSectionHeader);
}

/**
 * Returns true if a line starts a new markdown section heading (#+).
 */
export function isHeaderLine(line: string): boolean {
  return /^#+\s+/.test(line.trim());
}

/**
 * Strips markdown links, bold/italic markers, and inline backticks from a line.
 */
export function sanitizeLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * Parses a bullet list item, checkbox list item, or numbered list item.
 * Returns the sanitized criterion text, or null if the line is not a list item.
 */
export function parseBulletLine(line: string): string | null {
  const match = line.match(/^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?(.+)$/);
  return match?.[1] ? sanitizeLine(match[1]) : null;
}

/**
 * Extracts acceptance criteria from plain/markdown ticket text.
 *
 * When an acceptance criteria section header is present:
 * - Extracts list items and descriptive lines until the next section heading.
 *
 * When no section header is present:
 * - Extracts bullet/list items found in the text.
 * - If no list items exist, returns an empty array.
 */
export function extractAcceptanceCriteria(text?: string | null): string[] {
  if (!text || typeof text !== "string") return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const headerIdx = lines.findIndex(isSectionHeader);

  if (headerIdx >= 0) {
    const sectionLines: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) continue;
      if (isHeaderLine(currentLine)) break;
      const bullet = parseBulletLine(currentLine);
      if (bullet) {
        sectionLines.push(bullet);
      } else if (currentLine.length > 5) {
        sectionLines.push(sanitizeLine(currentLine));
      }
    }
    return sectionLines;
  }

  return lines.map(parseBulletLine).filter((b): b is string => Boolean(b));
}

/**
 * Canonical alias for extractAcceptanceCriteria.
 */
export const extractCriteria = extractAcceptanceCriteria;
