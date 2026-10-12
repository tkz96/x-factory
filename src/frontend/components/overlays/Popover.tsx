// src/frontend/components/overlays/Popover.tsx — Popover primitive built on React Aria (#250).
//
// A floating container anchored to its trigger. React Aria moves focus in, keeps
// Tab inside, and returns focus to the trigger on close; this module adds the
// stack-aware Escape so it dismisses only when it is the top layer.

import "./Popover.css";

import { type ReactNode, useContext, useRef } from "react";
import {
  OverlayTriggerStateContext,
  Dialog as RACDialog,
  DialogTrigger as RACDialogTrigger,
  Popover as RACPopover,
  type PopoverProps as RACPopoverProps,
} from "react-aria-components";
import {
  useOverlayDismiss,
  useOverlayPresence,
  useRestoreFocus,
} from "./overlay-stack.js";

export const PopoverTrigger = RACDialogTrigger;

export interface PopoverProps extends Omit<RACPopoverProps, "children"> {
  className?: string;
  children: ReactNode;
}

export function Popover({ className, children, ...props }: PopoverProps) {
  const state = useContext(OverlayTriggerStateContext);
  const isOpen = state?.isOpen ?? true;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  useOverlayDismiss(isOpen, () => state?.close());
  // Closing animates (#250): React Aria marks the popover `data-exiting` and Popover.css
  // plays the exit from that state, so the popover stays mounted until it has ended.
  // `shouldSkipAnimation` stays off, or React Aria would report no entering or exiting
  // state at all.
  const isPresent = useOverlayPresence(popoverRef, isOpen);
  // Focus returns to the trigger once the popover has left the screen, not while its
  // exit animation still plays.
  useRestoreFocus(isPresent);

  if (!isPresent) return null;

  return (
    <RACPopover
      ref={popoverRef}
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
