// src/frontend/shortcuts/registry.ts — One registry of keyboard shortcuts (#254).
//
// Every shortcut is defined once here. The global handler, the command palette
// and the ? sheet all read from this list, so a binding cannot drift between
// them. Mod is ⌘ on macOS and Ctrl everywhere else (the web-app convention the
// spec chose), and labels render per platform.

export type ShortcutGroup = "Navigation" | "Actions" | "Help";

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  group: ShortcutGroup;
  /**
   * Steps in order. A step is a key, or modifier+key such as "mod+k".
   * Two or more steps form a sequence ("g" then "t"). Empty means no chord.
   */
  steps: readonly string[];
  /** Where the same action is reachable without the keyboard. */
  alternative: string;
}

export const SHORTCUT_IDS = [
  "palette",
  "goQueue",
  "goRuns",
  "goProjects",
  "newRun",
  "search",
  "help",
  "stopRun",
  "close",
  "moveUp",
  "moveDown",
  "openItem",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "palette",
    label: "Command palette",
    group: "Navigation",
    steps: ["mod+k"],
    alternative: "Search button in the toolbar",
  },
  {
    id: "goQueue",
    label: "Go to Work Queue",
    group: "Navigation",
    steps: ["g", "t"],
    alternative: "Work Queue in the sidebar",
  },
  {
    id: "goRuns",
    label: "Go to Active Runs",
    group: "Navigation",
    steps: ["g", "r"],
    alternative: "Active Runs in the sidebar",
  },
  {
    id: "goProjects",
    label: "Go to Projects",
    group: "Navigation",
    steps: ["g", "p"],
    alternative: "Projects in the sidebar",
  },
  {
    id: "search",
    label: "Focus search",
    group: "Navigation",
    steps: ["/"],
    alternative: "Search button in the toolbar",
  },
  {
    id: "newRun",
    label: "New run",
    group: "Actions",
    steps: ["n"],
    alternative: "New Run button in the toolbar",
  },
  {
    id: "stopRun",
    label: "Stop run",
    group: "Actions",
    steps: [],
    alternative: "Command palette, then Stop Run",
  },
  {
    id: "help",
    label: "Keyboard shortcuts",
    group: "Help",
    steps: ["?"],
    alternative: "Command palette, then Keyboard Shortcuts",
  },
  {
    id: "close",
    label: "Close the top layer",
    group: "Help",
    steps: ["escape"],
    alternative: "Close button",
  },
  {
    id: "moveUp",
    label: "Previous item in a list",
    group: "Navigation",
    steps: ["arrowup"],
    alternative: "Mouse or touch",
  },
  {
    id: "moveDown",
    label: "Next item in a list",
    group: "Navigation",
    steps: ["arrowdown"],
    alternative: "Mouse or touch",
  },
  {
    id: "openItem",
    label: "Open the highlighted item",
    group: "Navigation",
    steps: ["enter"],
    alternative: "Click or tap the item",
  },
];

/**
 * Combinations the operating system or the browser keeps for itself, or that
 * the browser does not let a page take over. An application shortcut must not
 * use these (spec #241, conflict rule).
 */
export const RESERVED_BINDINGS: readonly string[] = [
  "mod+n",
  "mod+t",
  "mod+w",
  "mod+q",
  "mod+r",
  "mod+l",
  "mod+d",
  "mod+p",
  "mod+s",
  "mod+f",
  "mod+h",
  "mod+m",
  "mod+tab",
  "ctrl+tab",
  "mod+shift+t",
  "mod+shift+n",
];

/**
 * Combinations a page can override, but only once verified with real keyboard
 * input on every supported browser and OS. Mod+K is the one shipped here.
 */
export const OVERRIDABLE_BINDINGS: readonly string[] = ["mod+k"];

export function getShortcut(id: ShortcutId): ShortcutDefinition {
  const found = SHORTCUTS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown shortcut: ${id}`);
  return found;
}

const KEY_LABELS_MAC: Record<string, string> = {
  escape: "Esc",
  enter: "Return",
  arrowup: "↑",
  arrowdown: "↓",
};

const KEY_LABELS_OTHER: Record<string, string> = {
  escape: "Esc",
  enter: "Enter",
  arrowup: "↑",
  arrowdown: "↓",
};

function labelForStep(step: string, isMac: boolean): string {
  const labels = isMac ? KEY_LABELS_MAC : KEY_LABELS_OTHER;
  const parts = step.split("+");
  const key = parts.pop() ?? "";
  const prefix = parts
    .map((part) => {
      if (part === "mod") return isMac ? "⌘" : "Ctrl+";
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}+`;
    })
    .join("");
  const named = labels[key];
  const shown = named ?? (key.length === 1 ? key.toUpperCase() : key);
  // Mac labels are symbols with no separator (⌘K); other platforms use Ctrl+K.
  if (prefix === "⌘" && isMac) return `⌘${shown}`;
  return `${prefix}${shown}`;
}

/** The on-screen label for a shortcut, per platform ("⌘K", "G then T", "Ctrl+K"). */
export function formatShortcut(
  def: ShortcutDefinition,
  isMac: boolean,
): string | null {
  if (def.steps.length === 0) return null;
  return def.steps.map((step) => labelForStep(step, isMac)).join(" then ");
}

/** True when the platform is macOS (or iOS), where Mod is ⌘. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const source = `${navigator.platform} ${navigator.userAgent}`;
  return /mac|iphone|ipad/i.test(source);
}
