// src/frontend/components/overlays/Tooltip.tsx — Tooltip primitive built on React Aria (#250).
//
// Descriptive text shown on hover and keyboard focus, with role="tooltip". Escape
// hides the tooltip through the top-layer stack.

import "./Tooltip.css";

import { type ReactNode, useContext } from "react";
import {
  Tooltip as RACTooltip,
  type TooltipProps as RACTooltipProps,
  TooltipTrigger as RACTooltipTrigger,
  TooltipTriggerStateContext,
} from "react-aria-components";
import { useOverlayDismiss, useRestoreFocus } from "./overlay-stack.js";

export const TooltipTrigger = RACTooltipTrigger;

export interface TooltipProps extends Omit<RACTooltipProps, "children"> {
  className?: string;
  children: ReactNode;
}

export function Tooltip({ className, children, ...props }: TooltipProps) {
  const state = useContext(TooltipTriggerStateContext);
  useOverlayDismiss(state?.isOpen ?? false, () => state?.close(true));
  useRestoreFocus(state?.isOpen ?? false);

  if (state && !state.isOpen) return null;

  return (
    <RACTooltip className={`xf-tooltip ${className ?? ""}`.trim()} {...props}>
      {children}
    </RACTooltip>
  );
}
