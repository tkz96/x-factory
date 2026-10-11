// src/frontend/hooks/useDialogFocus.ts — Focus management shared by every dialog (#245).
//
// While a dialog is open: focus moves into it, Tab and Shift+Tab cycle inside it,
// everything outside it is inert (not focusable, hidden from assistive tech), and
// on close focus returns to whatever opened it. Escape stays with each dialog's
// own dismissal handler. The dialog must be portalled to <body> (see DialogPortal)
// so that "everything outside" can be expressed as the other children of <body>.

import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  active = true,
): void {
  const trigger = useRef<Element | null>(null);
  // Captured during render: child autofocus runs at commit and would otherwise win.
  if (active && trigger.current === null && typeof document !== "undefined") {
    trigger.current = document.activeElement;
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;

    const inerted: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child.contains(dialog) || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }

    if (!dialog.contains(document.activeElement)) {
      (focusableWithin(dialog)[0] ?? dialog).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableWithin(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const el of inerted) el.removeAttribute("inert");
      const back = trigger.current;
      trigger.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [ref, active]);
}
