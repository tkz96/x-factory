// src/frontend/lib/markdown-syntax.ts — Whether a text is written in Markdown. Pure: no DOM, no React.
// The run chat uses it to decide whether a text gets a Preview / Raw toggle; a plain sentence gets none.

const MARKDOWN_SYNTAX: readonly RegExp[] = [
  /^\s{0,3}#{1,6}\s+\S/m, // heading
  /^\s*(?:[-*+]|\d+\.)\s+\S/m, // list item
  /^\s*>\s?\S/m, // blockquote
  /^\s*```/m, // fenced code
  /`[^`\n]+`/, // inline code
  /\*\*[^*\n]+\*\*|__[^_\n]+__/, // bold
  /(^|[^\w*])\*(?=\S)[^*\n]*?\S\*(?![\w*])/, // italic with asterisks
  /(^|[^\w_])_(?=\S)[^_\n]*?\S_(?![\w_])/, // italic with underscores
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
  /^\s*\|.*\|\s*$/m, // table row
];

/** True when the text carries at least one piece of Markdown syntax (headings, lists, code, emphasis, links). */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_SYNTAX.some((pattern) => pattern.test(text));
}
