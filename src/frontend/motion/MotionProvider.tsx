// src/frontend/motion/MotionProvider.tsx — the one place the motion library mounts.
//
// LazyMotion keeps the feature bundle out of the entry chunk: it is fetched with
// the dynamic import in motion-features.ts the first time a motion component
// renders. MotionConfig's reducedMotion="user" is what makes the motion library
// honour prefers-reduced-motion: transform and layout animations are dropped and
// what is left is a short crossfade (#252). Its default transition is the
// snappy spring, so a block that animates (the segmented control's thumb) needs
// no import from this folder; every other motion component names its own.

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { loadMotionFeatures } from "./motion-features.js";
import { SPRING_SNAPPY } from "./motion-springs.js";

export interface MotionProviderProps {
  children: ReactNode;
}

export function MotionProvider({ children }: MotionProviderProps) {
  return (
    <LazyMotion features={loadMotionFeatures}>
      <MotionConfig reducedMotion="user" transition={SPRING_SNAPPY}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
