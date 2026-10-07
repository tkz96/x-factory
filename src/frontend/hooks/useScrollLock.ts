// src/frontend/hooks/useScrollLock.ts — Reusable background scroll lock for modal surfaces.
//
// While a modal is open the page behind it must not scroll (the modal's own body
// is the only scroll container). This is structural modal behavior shared by every
// dialog, so it lives here as a small reusable hook rather than inside any one
// wizard or modal. The previous overflow value is restored on release so nested or
// sequential modals never leave the page in a broken scroll state.

import { useEffect } from "react";

export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}
