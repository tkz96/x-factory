// src/frontend/shortcuts/match.ts — Matching keyboard events against registry steps (#254).

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Mod is ⌘ on macOS and Ctrl elsewhere; it never matches the other key. */
export function eventMatchesStep(
  event: KeyEventLike,
  step: string,
  isMac: boolean,
): boolean {
  const parts = step.split("+");
  const key = parts.pop() ?? "";
  const wantsMod = parts.includes("mod");
  if (wantsMod) {
    const modDown = isMac ? event.metaKey : event.ctrlKey;
    const otherMod = isMac ? event.ctrlKey : event.metaKey;
    if (!modDown || otherMod || event.altKey || event.shiftKey) return false;
  } else if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }
  return event.key.toLowerCase() === key;
}

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** True when the target takes typed text, so single-key shortcuts must not fire. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") {
    return false;
  }
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type || "text";
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}
