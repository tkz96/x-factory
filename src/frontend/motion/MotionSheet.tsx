// src/frontend/motion/MotionSheet.tsx — a sheet that rises into place.
//
// A sheet explains where it came from: it grows from just below its resting
// position, so the eye follows it up instead of seeing a panel appear. It is
// only a surface: focus, roles and dismissal belong to the overlay building
// blocks (ticket #250), which wrap this component. Under reduced motion
// MotionConfig drops the rise and keeps the crossfade (#252).

import { m } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_SMOOTH, SPRING_SNAPPY } from "./motion-springs.js";

export interface MotionSheetProps {
  children: ReactNode;
  className?: string;
}

export function MotionSheet({ children, className }: MotionSheetProps) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, transition: SPRING_SNAPPY }}
      transition={SPRING_SMOOTH}
    >
      {children}
    </m.div>
  );
}
