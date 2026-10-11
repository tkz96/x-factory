// src/frontend/motion/MotionProvider.tsx — the one place the motion library mounts.
//
// LazyMotion keeps the feature bundle out of the entry chunk: it is fetched with
// the dynamic import in motion-features.ts the first time a motion component
// renders. MotionConfig's reducedMotion="user" is what makes the motion library
// honour prefers-reduced-motion: transform and layout animations are dropped and
// what is left is a short crossfade (#252).

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { loadMotionFeatures } from "./motion-features.js";

export interface MotionProviderProps {
  children: ReactNode;
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <LazyMotion features={loadMotionFeatures}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
