// src/frontend/motion/motion-springs.ts — how the motion library should feel.
//
// CSS motion (keyframes and transitions) takes every duration and easing from
// the tokens in src/frontend/styles/tokens.css. Springs have no fixed duration —
// they settle on physics — so the parameters live here instead, inside the range
// .agents/skills/review-animations/STANDARDS.md sets out: keep bounce subtle
// (0.1–0.3), and let system responses snap faster than deliberate ones.

import type { MotionProps } from "motion/react";

/** A spring has no fixed duration: it settles on physics. */
type Spring = NonNullable<MotionProps["transition"]>;

/** Entering or leaving content: calm, no visible overshoot. */
export const SPRING_SMOOTH: Spring = {
  type: "spring",
  duration: 0.4,
  bounce: 0.15,
};

/** Direct manipulation — a press, a drag release, a dismissed sheet. */
export const SPRING_SNAPPY: Spring = {
  type: "spring",
  duration: 0.25,
  bounce: 0.2,
};
