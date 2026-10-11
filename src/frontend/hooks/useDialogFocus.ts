// src/frontend/hooks/useDialogFocus.ts — Focus management for an inline alertdialog (#245, #250).
//
// While the dialog is open: focus moves into it, Tab and Shift+Tab cycle inside it,
// everything else under <body> is inert, and on close focus returns to whatever
// opened it. The behaviour is the shared overlay behaviour from
// components/overlays/overlay-stack.ts. Modal overlays use the React Aria based
// primitives directly; this hook serves dialogs that stay inline in their card.

import { type RefObject, useEffect } from "react";
import {
  useFocusTrap,
  useInertBackground,
  useRestoreFocus,
} from "../components/overlays/overlay-stack.js";

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  active = true,
): void {
  useRestoreFocus(active);
  useInertBackground(ref, active);
  useFocusTrap(ref, active);

  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog || dialog.contains(document.activeElement)) return;
    const first = dialog.querySelector<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    (first ?? dialog).focus();
  }, [ref, active]);
}
