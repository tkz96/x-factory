// src/pollution.ts — Path patterns for sensitive or generated files that must never be delivered.

/**
 * Dangerous/generated pollution patterns.
 * Explicitly allows .env.example, .env.template, etc.
 */
export const POLLUTION_PATTERNS = [
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\..+\.local$/,
  /(^|\/)[^/]+\.log$/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)\.temp(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
];

export function isPollutionPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return POLLUTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
