// src/frontend/shortcuts/useGlobalShortcuts.ts — Window-level handling of registry shortcuts (#254).
//
// One listener on window. Mod+K is the only shortcut that works in a text field.
// Every other shortcut is ignored while a text field has focus, while a dialog
// is open (the dialog owns the keyboard), and while a modifier is held.

import { useEffect, useRef } from "react";
import { eventMatchesStep, isTextEntryTarget } from "./match.js";
import { isMacPlatform } from "./registry.js";

/** How long after "g" the second key of a G-sequence may follow. */
export const SEQUENCE_TIMEOUT_MS = 1000;

export interface GlobalShortcutHandlers {
  togglePalette: () => void;
  openHelp: () => void;
  newRun: () => void;
  navigate: (path: string) => void;
}

/** The page's search field, marked with data-search-input, or null. */
function findSearchInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-search-input]");
}

function dialogIsOpen(): boolean {
  return document.querySelector(".xf-dialog-overlay") !== null;
}

const SECTION_KEYS: Record<string, string> = {
  t: "/queue",
  r: "/runs",
  p: "/projects",
};

export function useGlobalShortcuts(handlers: GlobalShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const isMac = isMacPlatform();
    let gPressedAt: number | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const h = handlersRef.current;

      if (eventMatchesStep(event, "mod+k", isMac)) {
        event.preventDefault();
        h.togglePalette();
        return;
      }

      // Everything below is a single key or a sequence. It yields to text
      // fields, to open dialogs and to browser or OS modifier combinations.
      if (isTextEntryTarget(event.target) || dialogIsOpen()) {
        gPressedAt = null;
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        gPressedAt = null;
        return;
      }

      const key = event.key.toLowerCase();
      const now = Date.now();
      if (gPressedAt !== null) {
        const within = now - gPressedAt <= SEQUENCE_TIMEOUT_MS;
        gPressedAt = null;
        const target = within ? SECTION_KEYS[key] : undefined;
        if (target) {
          event.preventDefault();
          h.navigate(target);
        }
        return;
      }

      if (key === "g") {
        gPressedAt = now;
        return;
      }
      if (key === "n") {
        event.preventDefault();
        h.newRun();
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        const search = findSearchInput();
        if (search) search.focus();
        else h.togglePalette();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        h.openHelp();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
