// src/frontend/components/overlays/Popover.tsx — Popover primitive built on React Aria (#250).
//
// A floating container anchored to its trigger. React Aria moves focus in, keeps
// Tab inside, and returns focus to the trigger on close; this module adds the
// stack-aware Escape so it dismisses only when it is the top layer.

import "./Popover.css";

import { type ReactNode, useContext } from "react";
import {
  OverlayTriggerStateContext,
  Dialog as RACDialog,
  DialogTrigger as RACDialogTrigger,
  Popover as RACPopover,
  type PopoverProps as RACPopoverProps,
} from "react-aria-components";
import { useOverlayDismiss, useRestoreFocus } from "./overlay-stack.js";

export const PopoverTrigger = RACDialogTrigger;

export interface PopoverProps extends Omit<RACPopoverProps, "children"> {
  className?: string;
  children: ReactNode;
}

export function Popover({ className, children, ...props }: PopoverProps) {
  const state = useContext(OverlayTriggerStateContext);
  useOverlayDismiss(state?.isOpen ?? true, () => state?.close());
  useRestoreFocus(state?.isOpen ?? true);

  if (state && !state.isOpen) return null;

  return (
    <RACPopover
      shouldSkipAnimation
      className={`xf-popover ${className ?? ""}`.trim()}
      {...props}
    >
      {children}
    </RACPopover>
  );
}

export function PopoverContent({
  id,
  className,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  children,
}: {
  id?: string | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  children: ReactNode;
}) {
  return (
    <RACDialog
      {...(id ? { id } : {})}
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      {...(ariaLabelledBy ? { "aria-labelledby": ariaLabelledBy } : {})}
      className={`xf-popover-content ${className ?? ""}`.trim()}
    >
      {children}
    </RACDialog>
  );
}
