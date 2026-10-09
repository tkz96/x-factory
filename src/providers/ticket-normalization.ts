// src/providers/ticket-normalization.ts — Ticket normalization module (#185).
//
// Single source of truth for turning ticket text into acceptance criteria.
// Adapters only convert their provider-specific format to text (HTML for Azure,
// ADF for Jira, Markdown for GitHub).

import type { TicketQueryOptions } from "./contract.js";
import { DEFAULT_PAGE_CAP } from "./http.js";

/**
 * Resolves the page cap for ticket listing queries.
 * Precedence: TicketQueryOptions.pageCap -> providerDefault -> DEFAULT_PAGE_CAP.
 */
export function resolvePageCap(
  options?: TicketQueryOptions,
  providerDefault?: number,
): number {
  return options?.pageCap ?? providerDefault ?? DEFAULT_PAGE_CAP;
}

/**
 * Surfaces a warning through the logger when ticket listing hits the page cap.
 */
export function emitTruncationWarning(provider: string, pageCap: number): void {
  console.warn(
    `[X-Factory] Ticket listing for provider "${provider}" reached page cap of ${pageCap}; results were truncated.`,
  );
}

/**
 * Returns true if a line represents an acceptance criteria section heading.
 * Handles markdown prefixes (#+), trailing colons, and markdown styling (*, _).
 */
function isSectionHeader(line: string): boolean {
  const stripped = line.replace(/[*_]/g, "").trim();
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(
    stripped,
  );
}

/**
 * Returns true if a line starts a new markdown section heading (#+).
 */
function isHeaderLine(line: string): boolean {
  return /^#+\s+/.test(line.trim());
}

/**
 * Strips markdown links, bold/italic markers, and inline backticks from a line.
 */
function sanitizeLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * Parses a bullet list item, checkbox list item, or numbered list item.
 * Returns the sanitized criterion text, or null if the line is not a list item.
 */
function parseBulletLine(line: string): string | null {
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
