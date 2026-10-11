// src/frontend/components/DialogPortal.tsx — Renders a dialog as a direct child of <body> (#245).
//
// Dialogs sit outside the app root so useDialogFocus can make the rest of the
// page inert without also disabling the dialog itself.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function DialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}
