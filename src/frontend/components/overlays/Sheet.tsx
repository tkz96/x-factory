// src/frontend/components/overlays/Sheet.tsx — Sheet overlay primitive built on React Aria (#250).
//
// Extends modal dialog semantics with edge-docked sheet presentations (bottom/right/left)
// and physical slide-in transitions with reduced-motion crossfade.

import "./Sheet.css";

import type { ReactNode } from "react";
import { Dialog, type DialogProps } from "./Dialog.js";

/**
 * Where a sheet is docked. `center` is the sheet that is not docked to an edge:
 * it sits in the middle of the window and takes the height of what it holds
 * (the assistant shape, #268).
 */
export type SheetPosition = "bottom" | "right" | "left" | "center";

export interface SheetProps extends Omit<DialogProps, "className"> {
  position?: SheetPosition;
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
