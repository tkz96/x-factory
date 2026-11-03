// src/frontend/motion/MotionList.tsx — a list row that moves, rather than jump.
//
// MotionListItem is one row. `layout` is what animates a row from where it was
// to where it now is when the order changes, so a re-sorted list keeps the eye
// on the row the user was reading. A row does not scale or move on its own,
// and under reduced motion MotionConfig leaves the rows where the browser puts
// them (#252).
//
// A caller that also removes rows wraps the items in AnimatePresence, so a
// departing row gets its exit crossfade before it leaves the DOM.

import { m } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_SMOOTH } from "./motion-springs.js";

export interface MotionListItemProps {
  children: ReactNode;
  className?: string;
}

export function MotionListItem({ children, className }: MotionListItemProps) {
  return (
    <m.div
      className={className}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SPRING_SMOOTH}
    >
      {children}
    </m.div>
  );
}
