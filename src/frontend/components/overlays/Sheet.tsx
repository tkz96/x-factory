// src/frontend/components/overlays/Sheet.tsx — Sheet overlay primitive built on React Aria (#250).
//
// Extends modal dialog semantics with edge-docked sheet presentations (bottom/right/left)
// and physical slide-in transitions with reduced-motion crossfade.

import "./Sheet.css";

import type { ReactNode } from "react";
import { Dialog, type DialogProps } from "./Dialog.js";

export interface SheetProps extends Omit<DialogProps, "className"> {
  position?: "bottom" | "right" | "left";
  className?: string;
  children: ReactNode;
}

export function Sheet({
  position = "bottom",
  className,
  ...dialogProps
}: SheetProps) {
  const positionClass = `xf-sheet-${position}`;
  return (
    <Dialog
      {...dialogProps}
      className={`xf-sheet-modal ${positionClass} ${className ?? ""}`.trim()}
    />
  );
}
