// src/frontend/motion/MotionDrag.tsx — a surface that follows a finger.
//
// Used for the phone-width sheet: the sheet resists past its resting place
// instead of hitting an invisible wall, and springs back when released. The
// caller decides what a release means (dismiss, or stay) from motion's pan info,
// where `info.offset.y` is how far down the gesture travelled in points.
// Dragging is direct manipulation, so it stays available under reduced motion —
// what goes away there is the automatic movement, not the gesture (#252).

import type { MotionProps } from "motion/react";
import { m } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_SNAPPY } from "./motion-springs.js";

export interface MotionDragProps {
  children: ReactNode;
  className?: string;
  /** Called when the gesture ends, with how far the surface travelled. */
  onDragEnd?: NonNullable<MotionProps["onDragEnd"]>;
}

/** The surface rests where the layout put it; over-drag is what moves it. */
const DRAG_REST = { top: 0, bottom: 0 };
const DRAG_RESISTANCE = 0.2;

export function MotionDrag({
  children,
  className,
  onDragEnd,
}: MotionDragProps) {
  return (
    <m.div
      className={className}
      drag="y"
      dragConstraints={DRAG_REST}
      dragElastic={DRAG_RESISTANCE}
      dragMomentum={false}
      transition={SPRING_SNAPPY}
      onDragEnd={onDragEnd}
    >
      {children}
    </m.div>
  );
}
