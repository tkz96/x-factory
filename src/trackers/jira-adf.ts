// src/trackers/jira-adf.ts — Atlassian Document Format (ADF) AST recursive traversal.

/**
 * Parse Atlassian Document Format (ADF) into readable plain text.
 */
export function parseAdfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") {
    return obj.text;
  }
  if (Array.isArray(obj.content)) {
    const pieces = obj.content.map(parseAdfToText);
    if (obj.type === "bulletList") {
      return pieces.map((p) => `- ${p.trim()}`).join("\n");
    }
    if (obj.type === "paragraph" || obj.type === "heading") {
      return pieces.join("") + "\n";
    }
    return pieces.join(" ");
  }
  return "";
}
