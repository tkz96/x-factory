// src/frontend/motion/MotionEntry.tsx — a row that arrives.
//
// Used for chat entries and for anything else that appears in an existing list.
// It fades in and rises a little; nothing appears from nothing, so the opacity
// never starts at zero-sized and the scale never starts at zero
// (.agents/skills/review-animations/STANDARDS.md). Under reduced motion
// MotionConfig drops the rise and keeps the crossfade (#252).
//
// The duration and easing of the CSS animation that lands a row in place come
// from src/frontend/styles/tokens.css. This component uses a spring instead,
// because the arrival is interruptible: a second row can arrive while the first
// is still settling. Springs retarget from their current velocity; keyframes
// restart.

import { m } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_SMOOTH, SPRING_SNAPPY } from "./motion-springs.js";

export interface MotionEntryProps {
  children: ReactNode;
  className?: string;
}

/** Hidden but present: a small rise, never a scale from zero. */
const ENTRY_HIDDEN = { opacity: 0, y: 8 };
const ENTRY_SHOWN = { opacity: 1, y: 0 };

export function MotionEntry({ children, className }: MotionEntryProps) {
  return (
    <m.div
      className={className}
      initial={ENTRY_HIDDEN}
      animate={ENTRY_SHOWN}
      // Leaving is a quick crossfade: a deliberate arrival, a snappy departure.
      exit={{ opacity: 0, y: 4, transition: SPRING_SNAPPY }}
      transition={SPRING_SMOOTH}
    >
      {children}
    </m.div>
  );
}
