// src/frontend/components/overlays/overlay-stack.ts — Top-layer Escape and background inertness for overlays (#250).
//
// React Aria handles focus containment and focus restore inside each overlay.
// What it does not know is that several overlays can be open at once (an alert
// over a dialog), so this module keeps the stack: Escape dismisses only the top
// layer, and while an overlay is open the rest of <body> is inert.

import { type RefObject, useEffect, useRef } from "react";

type DismissHandler = () => void;

const stack: DismissHandler[] = [];
let listening = false;

function onEscape(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Capture phase on window: the top layer gets the key first and nothing
  // underneath (including React Aria's own Escape handling) sees it.
  e.stopPropagation();
  e.preventDefault();
  top();
}

/** Registers `onDismiss` as the top layer while `isOpen` is true. */
export function useOverlayDismiss(
  isOpen: boolean,
  onDismiss: () => void,
): void {
  const handlerRef = useRef(onDismiss);
  handlerRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return;
    const handler = () => handlerRef.current();
    stack.push(handler);
    if (!listening) {
      window.addEventListener("keydown", onEscape, true);
      listening = true;
    }
    return () => {
      const idx = stack.lastIndexOf(handler);
      if (idx !== -1) stack.splice(idx, 1);
      if (stack.length === 0 && listening) {
        window.removeEventListener("keydown", onEscape, true);
        listening = false;
      }
    };
  }, [isOpen]);
}

/**
 * Makes every child of <body> that does not contain `ref` inert while open,
 * so the page behind a modal cannot be reached by keyboard or assistive tech.
 */
export function useInertBackground(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
): void {
  useEffect(() => {
    const container = ref.current;
    if (!isOpen || !container) return;
    const inerted: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child.contains(container) || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }
    return () => {
      for (const el of inerted) el.removeAttribute("inert");
    };
  }, [ref, isOpen]);
}

/**
 * Returns focus to whatever had it when the overlay opened, once it closes.
 * The trigger is read during render, before React Aria moves focus inside.
 */
export function useRestoreFocus(isOpen: boolean): void {
  const trigger = useRef<HTMLElement | null>(null);
  if (isOpen && trigger.current === null && typeof document !== "undefined") {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      const back = trigger.current;
      trigger.current = null;
      if (back?.isConnected) back.focus();
    };
  }, [isOpen]);
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Keeps Tab and Shift+Tab cycling inside a modal container while it is open. */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
): void {
  useEffect(() => {
    const container = ref.current;
    if (!isOpen || !container) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        container.focus();
      } else if (
        e.shiftKey &&
        (current === first || !container.contains(current))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (current === last || !container.contains(current))
      ) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ref, isOpen]);
}
