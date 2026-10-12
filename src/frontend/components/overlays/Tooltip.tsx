// src/frontend/components/overlays/Tooltip.tsx — Tooltip primitive built on React Aria (#250).
//
// Descriptive text shown on hover and keyboard focus, with role="tooltip". Escape
// hides the tooltip through the top-layer stack.

import "./Tooltip.css";

import { type ReactNode, useContext, useRef } from "react";
import {
  Tooltip as RACTooltip,
  type TooltipProps as RACTooltipProps,
  TooltipTrigger as RACTooltipTrigger,
  TooltipTriggerStateContext,
} from "react-aria-components";
import {
  useOverlayDismiss,
  useOverlayPresence,
  useRestoreFocus,
} from "./overlay-stack.js";

export const TooltipTrigger = RACTooltipTrigger;

export interface TooltipProps extends Omit<RACTooltipProps, "children"> {
  className?: string;
  children: ReactNode;
}

export function Tooltip({ className, children, ...props }: TooltipProps) {
  const state = useContext(TooltipTriggerStateContext);
  const isOpen = state?.isOpen ?? false;
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  useOverlayDismiss(isOpen, () => state?.close(true));
  // Closing animates (#250): React Aria marks the tooltip `data-exiting` and Tooltip.css
  // plays the exit from that state, so it stays mounted until the fade has ended.
  const isPresent = useOverlayPresence(tooltipRef, isOpen);
  // Focus returns to the trigger once the tooltip has left the screen, not while its
  // exit fade still plays.
  useRestoreFocus(isPresent);

  if (!isPresent) return null;

  return (
    <RACTooltip
      ref={tooltipRef}
      className={`xf-tooltip ${className ?? ""}`.trim()}
      {...props}
    >
      {children}
    </RACTooltip>
  );
}
